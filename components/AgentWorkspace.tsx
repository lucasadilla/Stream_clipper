"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import { EditorHeader } from "@/components/layout/EditorHeader";
import { CaptionAppearancePanel } from "@/components/CaptionAppearancePanel";
import {
  ClipSuggestionCard,
  type ClipSuggestionData,
} from "@/components/ClipSuggestionCard";
import { fetchJson } from "@/lib/apiClient";
import { formatDuration, formatSeconds } from "@/lib/time";
import {
  readCaptionAppearancePreference,
  writeCaptionAppearancePreference,
  type CaptionAppearance,
} from "@/lib/captionAppearance";
import {
  TRANSCRIPTION_FAST_TICK_MS,
  TRANSCRIPTION_SLOW_TICK_MS,
} from "@/lib/transcriptionConstants";
import { cn } from "@/lib/cn";
import {
  ChatContainerContent,
  ChatContainerRoot,
  ChatContainerScrollAnchor,
} from "@/components/ui/chat-container";
import { Message, MessageAvatar, MessageContent } from "@/components/ui/message";
import {
  PromptInput,
  PromptInputAction,
  PromptInputActions,
  PromptInputTextarea,
} from "@/components/ui/prompt-input";
import { ScrollButton } from "@/components/ui/scroll-button";
import { Button } from "@/components/ui/button";
import { ArrowUp } from "lucide-react";

interface AgentSessionData {
  id: string;
  title?: string | null;
  liveStatus?: string | null;
  storageLabel?: string;
  liveRecording?: { status: string; recordedSeconds: number } | null;
  sourceMedia?: Array<{ durationSeconds?: number | null }>;
  clipSuggestions?: ClipSuggestionData[];
}

type ChatTurn =
  | { id: string; role: "user"; text: string }
  | {
      id: string;
      role: "assistant";
      text: string;
      clip?: ClipSuggestionData | null;
      renderJobId?: string | null;
      error?: boolean;
    };

const MIN_TRANSCRIPT_SECONDS = 45;
const MIN_SEARCHABLE_CHUNKS = 3;

interface AgentWorkspaceProps {
  sessionId: string;
}

export function AgentWorkspace({ sessionId }: AgentWorkspaceProps) {
  const router = useRouter();
  const [session, setSession] = useState<AgentSessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [transcriptionError, setTranscriptionError] = useState<string | null>(
    null
  );
  const [transcribingActive, setTranscribingActive] = useState(false);
  const [transcribedSeconds, setTranscribedSeconds] = useState(0);
  const [searchableChunks, setSearchableChunks] = useState(0);
  const [clips, setClips] = useState<ClipSuggestionData[]>([]);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [prompt, setPrompt] = useState("");
  const [sending, setSending] = useState(false);
  const [captionAppearance, setCaptionAppearance] = useState<CaptionAppearance>(
    readCaptionAppearancePreference
  );
  const [includeCaptions, setIncludeCaptions] = useState(true);
  const sourceStarted = useRef(false);
  const transcribeInFlight = useRef(false);

  const loadSession = useCallback(async () => {
    const { ok, data } = await fetchJson<{
      session?: AgentSessionData;
      error?: string;
    }>(`/api/sessions/${sessionId}`);
    if (!ok || !data.session) {
      throw new Error(data.error ?? "Session not found");
    }
    setSession(data.session);
    if (data.session.clipSuggestions?.length) {
      setClips(data.session.clipSuggestions);
    }
  }, [sessionId]);

  useEffect(() => {
    void loadSession()
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load");
      })
      .finally(() => setLoading(false));
  }, [loadSession]);

  useEffect(() => {
    if (sourceStarted.current) return;
    sourceStarted.current = true;
    void fetchJson<{ error?: string }>(
      `/api/sessions/${sessionId}/download-source`,
      { method: "POST" }
    )
      .then(({ ok, data }) => {
        if (!ok) {
          setSourceError(
            data.error
              ? `Source download failed: ${data.error}`
              : "Source download failed on the server"
          );
          return;
        }
        setSourceError(null);
        void loadSession().catch(() => {});
      })
      .catch((err) => {
        setSourceError(
          err instanceof Error
            ? `Source download failed: ${err.message}`
            : "Source download failed on the server"
        );
      });
  }, [sessionId, loadSession]);

  const recordedSeconds = useMemo(
    () =>
      Math.max(
        session?.liveRecording?.recordedSeconds ?? 0,
        session?.sourceMedia?.[0]?.durationSeconds ?? 0,
        0
      ),
    [session]
  );

  const isLive =
    session?.liveStatus === "live" || session?.liveStatus === "upcoming";

  const transcriptionBehind =
    recordedSeconds > 5 && transcribedSeconds < recordedSeconds - 15;

  const transcriptReady =
    transcribedSeconds >= MIN_TRANSCRIPT_SECONDS &&
    searchableChunks >= MIN_SEARCHABLE_CHUNKS;

  useEffect(() => {
    if (!session) return;

    let cancelled = false;
    const tick = async () => {
      if (transcribeInFlight.current) return;
      transcribeInFlight.current = true;
      setTranscribingActive(true);
      try {
        const { ok, data } = await fetchJson<{
          error?: string;
          transcribedThrough?: number;
          transcriptChunks?: Array<{
            endTimeSeconds: number;
            text: string;
            rawJson?: { whisper?: boolean; cursorOnly?: boolean };
          }>;
        }>(`/api/sessions/${sessionId}/transcribe`, { method: "POST" });

        if (cancelled) return;

        if (!ok) {
          if (data.error?.toLowerCase().includes("enough audio")) {
            setTranscriptionError("Waiting for enough audio to transcribe…");
          } else if (data.error) {
            setTranscriptionError(data.error);
          }
          return;
        }

        setTranscriptionError(null);
        if (typeof data.transcribedThrough === "number") {
          setTranscribedSeconds(data.transcribedThrough);
        }

        const chunks = data.transcriptChunks ?? [];
        if (chunks.length > 0) {
          const usable = chunks.filter((c) => {
            const raw = c.rawJson;
            return (
              raw?.whisper &&
              !raw?.cursorOnly &&
              c.text !== "[silence]" &&
              c.text !== "[processing error]" &&
              c.text.trim().length > 8
            );
          });
          setSearchableChunks(usable.length);
          const maxEnd = Math.max(0, ...usable.map((c) => c.endTimeSeconds));
          if (maxEnd > 0) setTranscribedSeconds(maxEnd);
        }
        void loadSession().catch(() => {});
      } catch {
        // worker may still be progressing
      } finally {
        transcribeInFlight.current = false;
        if (!cancelled) setTranscribingActive(false);
      }
    };

    void tick();
    const ms = transcriptionBehind
      ? TRANSCRIPTION_FAST_TICK_MS
      : TRANSCRIPTION_SLOW_TICK_MS;
    const id = setInterval(() => void tick(), ms);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [
    sessionId,
    session?.id,
    transcriptionBehind,
    transcribedSeconds,
    loadSession,
  ]);

  async function handleDeleteSession() {
    const size = session?.storageLabel ? ` (${session.storageLabel})` : "";
    if (
      !window.confirm(
        `Delete this session and free disk space${size}?\n\nRemoves local recordings and rendered clips.`
      )
    ) {
      return;
    }

    setDeleting(true);
    try {
      const { ok, data } = await fetchJson<{ error?: string }>(
        `/api/sessions/${sessionId}`,
        { method: "DELETE" }
      );
      if (!ok) throw new Error(data.error ?? "Delete failed");
      posthog.capture("session_deleted", {
        session_id: sessionId,
        mode: "agent",
      });
      router.push("/");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Delete failed");
      setDeleting(false);
    }
  }

  async function handleSend() {
    const text = prompt.trim();
    if (!text || sending) return;
    if (!transcriptReady) {
      setTurns((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: "assistant",
          text: `Still ingesting transcript (${formatSeconds(transcribedSeconds)} ready). Try again once more of the stream is transcribed.`,
          error: true,
        },
      ]);
      return;
    }

    const userTurn: ChatTurn = {
      id: `user-${Date.now()}`,
      role: "user",
      text,
    };
    setTurns((prev) => [...prev, userTurn]);
    setPrompt("");
    setSending(true);
    posthog.capture("agent_clip_request", { session_id: sessionId });

    try {
      const { ok, data } = await fetchJson<{
        found?: boolean;
        answer?: string;
        clip?: ClipSuggestionData;
        renderJob?: { jobId?: string; downloadUrl?: string } | null;
        contextUsed?: number;
        error?: string;
      }>(`/api/sessions/${sessionId}/find-clip`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: text,
          autoRender: true,
          includeCaptions,
          captionAppearance,
        }),
      });

      if (!ok && data.error) {
        throw new Error(data.error);
      }

      if (data.found === false || !data.clip) {
        setTurns((prev) => [
          ...prev,
          {
            id: `asst-${Date.now()}`,
            role: "assistant",
            text:
              data.answer ??
              "I couldn't find that moment yet. Try quoting words from the stream, or wait for more transcript.",
            error: false,
          },
        ]);
        return;
      }

      const clip = data.clip;
      setClips((prev) => {
        const without = prev.filter((c) => c.id !== clip.id);
        return [clip, ...without];
      });

      setTurns((prev) => [
        ...prev,
        {
          id: `asst-${Date.now()}`,
          role: "assistant",
          text:
            data.answer ?? `Found “${clip.title}” and started rendering.`,
          clip,
          renderJobId: data.renderJob?.jobId ?? null,
        },
      ]);
    } catch (err) {
      setTurns((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: "assistant",
          text: err instanceof Error ? err.message : "Find clip failed",
          error: true,
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <div className="editor-shell min-h-screen flex flex-col bg-[var(--color-background)]">
        <EditorHeader title="Agent" />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-[var(--color-muted)] animate-pulse">Loading…</p>
        </div>
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="editor-shell min-h-screen flex flex-col bg-[var(--color-background)]">
        <EditorHeader title="Agent" />
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6">
          <p className="text-[var(--color-danger)]">{error ?? "Session not found"}</p>
          <Link href="/" className="text-[var(--color-accent)] text-sm hover:underline">
            Back to home
          </Link>
        </div>
      </div>
    );
  }

  const progressPct =
    recordedSeconds > 0
      ? Math.min(100, Math.round((transcribedSeconds / recordedSeconds) * 100))
      : 0;

  return (
    <div className="editor-shell h-screen flex flex-col bg-[var(--color-background)] overflow-hidden">
      <EditorHeader
        title={session.title}
        storageLabel={session.storageLabel}
        isLive={isLive}
        recordedSeconds={recordedSeconds}
        deleting={deleting}
        onDelete={handleDeleteSession}
      />

      <div className="shrink-0 border-b border-[var(--color-card-border)] bg-[#020302] px-4 py-3">
        <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--color-muted)]">
          <span className="font-semibold uppercase tracking-[0.12em] text-[var(--color-accent)]">
            Agent mode
          </span>
          <span>
            Transcript {formatSeconds(transcribedSeconds)}
            {recordedSeconds > 0 ? ` / ${formatSeconds(recordedSeconds)}` : ""}
          </span>
          {(transcribingActive || transcriptionBehind) && (
            <span className="flex items-center gap-1.5 text-[var(--color-accent)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)] animate-pulse" />
              Ingesting
            </span>
          )}
          {sourceError && (
            <span className="text-[var(--color-danger)]">{sourceError}</span>
          )}
          {transcriptionError && !sourceError && (
            <span className="text-[var(--color-warning,#e6b84d)]">
              {transcriptionError}
            </span>
          )}
        </div>
        <div className="mt-2 h-1 overflow-hidden bg-[#141414]">
          <div
            className="h-full bg-[var(--color-accent)] transition-[width] duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <section className="flex min-h-0 min-w-0 flex-1 flex-col border-b border-[var(--color-card-border)] lg:border-b-0 lg:border-r">
          <div className="relative min-h-0 flex-1">
            <ChatContainerRoot className="h-full px-3">
              <ChatContainerContent className="space-y-4 py-4">
                {turns.length === 0 && (
                  <Message>
                    <MessageAvatar src="" alt="Clipper" fallback="C" />
                    <MessageContent className="bg-secondary text-sm text-secondary-foreground">
                      {`Describe moments you want clipped — e.g. “the rage when he died to the sniper” or quote words you heard. Use specific wording from the stream for best results.${
                        !transcriptReady
                          ? ` Waiting for ~${formatDuration(MIN_TRANSCRIPT_SECONDS)} of searchable transcript (${searchableChunks}/${MIN_SEARCHABLE_CHUNKS} chunks)…`
                          : ""
                      }`}
                    </MessageContent>
                  </Message>
                )}

                {turns.map((turn) =>
                  turn.role === "user" ? (
                    <Message key={turn.id} className="justify-end">
                      <MessageContent className="bg-primary text-primary-foreground">
                        {turn.text}
                      </MessageContent>
                      <MessageAvatar src="" alt="You" fallback="You" />
                    </Message>
                  ) : (
                    <Message key={turn.id}>
                      <MessageAvatar src="" alt="Agent" fallback="AI" />
                      <div className="min-w-0 flex-1 space-y-3">
                        <MessageContent
                          markdown
                          className={cn(
                            "text-sm",
                            turn.error
                              ? "border border-destructive/40 bg-[#1a0808] text-[#ffb4b4]"
                              : "bg-secondary text-secondary-foreground"
                          )}
                        >
                          {turn.text}
                        </MessageContent>
                        {turn.clip && (
                          <ClipSuggestionCard
                            clip={turn.clip}
                            canRender
                            includeCaptions={includeCaptions}
                            captionAppearance={captionAppearance}
                            onUpdate={(next) => {
                              setClips((prev) =>
                                prev.map((c) => (c.id === next.id ? next : c))
                              );
                              setTurns((prev) =>
                                prev.map((t) =>
                                  t.role === "assistant" &&
                                  t.clip?.id === next.id
                                    ? { ...t, clip: next }
                                    : t
                                )
                              );
                            }}
                          />
                        )}
                      </div>
                    </Message>
                  )
                )}

                {sending && (
                  <Message>
                    <MessageAvatar src="" alt="Agent" fallback="AI" />
                    <MessageContent className="bg-secondary text-sm text-muted-foreground animate-pulse">
                      Finding and rendering clip…
                    </MessageContent>
                  </Message>
                )}
                <ChatContainerScrollAnchor />
              </ChatContainerContent>
              <div className="absolute right-4 bottom-4">
                <ScrollButton className="border-border bg-card shadow-sm" />
              </div>
            </ChatContainerRoot>
          </div>

          <div className="shrink-0 border-t border-[var(--color-card-border)] bg-[#020302] p-3">
            <PromptInput
              value={prompt}
              onValueChange={setPrompt}
              isLoading={sending}
              disabled={sending}
              onSubmit={() => {
                void handleSend();
              }}
              className="border-border bg-card"
            >
              <PromptInputTextarea
                placeholder={
                  transcriptReady
                    ? "Describe the clip you want…"
                    : "Waiting for transcript…"
                }
                className="text-foreground placeholder:text-muted-foreground"
              />
              <PromptInputActions className="justify-end pt-1">
                <PromptInputAction tooltip={sending ? "Working…" : "Send"}>
                  <Button
                    type="button"
                    size="icon"
                    disabled={sending || !prompt.trim()}
                    onClick={() => void handleSend()}
                    className="h-9 w-9 rounded-full"
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                </PromptInputAction>
              </PromptInputActions>
            </PromptInput>
          </div>
        </section>

        <aside className="flex min-h-0 w-full shrink-0 flex-col lg:w-[340px]">
          <div className="shrink-0 border-b border-[var(--color-card-border)] px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8f9b89]">
              Caption style
            </p>
            <label className="mt-2 flex items-center gap-2 text-xs text-[#c5cfc0]">
              <input
                type="checkbox"
                checked={includeCaptions}
                onChange={(e) => setIncludeCaptions(e.target.checked)}
                className="accent-[var(--color-accent)]"
              />
              Burn captions into renders
            </label>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            <CaptionAppearancePanel
              appearance={captionAppearance}
              onChange={(next) => {
                setCaptionAppearance(next);
                writeCaptionAppearancePreference(next);
              }}
              disabled={!includeCaptions}
            />
          </div>

          {clips.length > 0 && (
            <div className="max-h-[40%] shrink-0 overflow-y-auto border-t border-[var(--color-card-border)] p-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8f9b89]">
                Clips ({clips.length})
              </p>
              <div className="space-y-2">
                {clips.map((clip) => (
                  <ClipSuggestionCard
                    key={clip.id}
                    clip={clip}
                    canRender
                    includeCaptions={includeCaptions}
                    captionAppearance={captionAppearance}
                    onUpdate={(next) => {
                      setClips((prev) =>
                        prev.map((c) => (c.id === next.id ? next : c))
                      );
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
