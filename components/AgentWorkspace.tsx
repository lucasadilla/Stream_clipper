"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import { EditorHeader } from "@/components/layout/EditorHeader";
import {
  ClipSuggestionCard,
  type ClipSuggestionData,
} from "@/components/ClipSuggestionCard";
import { AgentClipPickGrid } from "@/components/agent/AgentClipPickGrid";
import { AgentClipEditor } from "@/components/agent/AgentClipEditor";
import { AgentCadenceChooser } from "@/components/agent/AgentCadenceChooser";
import { AgentClipStudioModal } from "@/components/agent/AgentClipStudioModal";
import { fetchJson } from "@/lib/apiClient";
import { formatDuration, formatSeconds } from "@/lib/time";
import { clipDownloadUrl, clipThumbnailApiUrl } from "@/lib/downloadUrls";
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
import { Button } from "@/components/ui/button";
import { ArrowUp } from "lucide-react";
import {
  DEFAULT_AGENT_WIZARD_STATE,
  LIVE_NOW_ROLL_SECONDS,
  LIVE_NOW_SUGGESTION_CAP,
  readAgentWizardState,
  type AgentCadence,
  type AgentWizardState,
  type AgentWizardStep,
} from "@/lib/agentWizard";
import {
  getContentLookPreset,
  type ContentLookPresetId,
} from "@/lib/contentLookPresets";
import {
  defaultVerticalLayoutSelection,
  type VerticalLayoutSelection,
} from "@/components/VerticalLayoutPicker";
import { triggerFileDownload } from "@/lib/clientDownload";

interface AgentSessionData {
  id: string;
  title?: string | null;
  liveStatus?: string | null;
  storageLabel?: string;
  metadataJson?: unknown;
  videoDurationSeconds?: number;
  liveRecording?: { status: string; recordedSeconds: number } | null;
  sourceMedia?: Array<{
    durationSeconds?: number | null;
    previewVideoUrl?: string | null;
    sourceVideoUrl?: string | null;
    sourceIsPlayableMp4?: boolean;
  }>;
  clipSuggestions?: ClipSuggestionData[];
}

type ChatTurn =
  | { id: string; role: "user"; text: string }
  | {
      id: string;
      role: "assistant";
      text: string;
      clip?: ClipSuggestionData | null;
      error?: boolean;
    };

const MIN_TRANSCRIPT_SECONDS = 20;
const MIN_SEARCHABLE_CHUNKS = 1;
const VOD_SUGGEST_ROLL_SECONDS = 180;

const STEP_LABELS: Record<AgentWizardStep, string> = {
  transcribing: "Transcribing",
  pick: "Pick clips",
  look: "Look",
  edit: "Edit",
  export: "Export",
  done: "Done",
};

interface AgentWorkspaceProps {
  sessionId: string;
}

function withThumbnails(
  _sessionId: string,
  clips: ClipSuggestionData[]
): Array<ClipSuggestionData & { thumbnailUrl: string }> {
  return clips.map((clip) => ({
    ...clip,
    thumbnailUrl: clipThumbnailApiUrl(clip.id),
  }));
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
  const [suggestionError, setSuggestionError] = useState<string | null>(null);
  const [transcribingActive, setTranscribingActive] = useState(false);
  const [transcribedSeconds, setTranscribedSeconds] = useState(0);
  const [searchableChunks, setSearchableChunks] = useState(0);
  const [clips, setClips] = useState<ClipSuggestionData[]>([]);
  const [wizard, setWizard] = useState<AgentWizardState>({
    ...DEFAULT_AGENT_WIZARD_STATE,
  });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [suggesting, setSuggesting] = useState(false);
  const [findingElapsedSec, setFindingElapsedSec] = useState(0);
  const [getMoreLoading, setGetMoreLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportDoneUrl, setExportDoneUrl] = useState<string | null>(null);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [prompt, setPrompt] = useState("");
  const [sending, setSending] = useState(false);
  const [showFindChat, setShowFindChat] = useState(false);
  const [newClipNotice, setNewClipNotice] = useState(false);
  const [studioClipId, setStudioClipId] = useState<string | null>(null);
  const [captionAppearance, setCaptionAppearance] = useState<CaptionAppearance>(
    readCaptionAppearancePreference
  );
  const sourceStarted = useRef(false);
  const transcribeInFlight = useRef(false);
  const suggestStarted = useRef(false);
  const rollingInFlight = useRef(false);
  const lastSessionRefreshAt = useRef(0);
  const visibleClips = useMemo(
    () => clips.filter((clip) => clip.status !== "rejected"),
    [clips]
  );

  const persistWizard = useCallback(
    async (patch: Partial<AgentWizardState>) => {
      const { ok, data } = await fetchJson<{
        wizard?: AgentWizardState;
        error?: string;
      }>(`/api/sessions/${sessionId}/agent-wizard`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (ok && data.wizard) {
        setWizard(data.wizard);
        return data.wizard;
      }
      setWizard((prev) => ({ ...prev, ...patch }));
      return null;
    },
    [sessionId]
  );

  const loadSession = useCallback(async () => {
    const { ok, data } = await fetchJson<{
      session?: AgentSessionData;
      error?: string;
    }>(`/api/sessions/${sessionId}`);
    if (!ok || !data.session) {
      throw new Error(data.error ?? "Session not found");
    }
    setSession(data.session);
    setClips(data.session.clipSuggestions ?? []);
    const nextWizard = readAgentWizardState(data.session.metadataJson);
    setWizard(nextWizard);
    if (nextWizard.selectedClipIds.length) {
      setSelectedIds(new Set(nextWizard.selectedClipIds));
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

  const isLive =
    session?.liveStatus === "live" || session?.liveStatus === "upcoming";

  const recordedSeconds = useMemo(() => {
    const localDuration = Math.max(
      0,
      ...(session?.sourceMedia ?? []).map(
        (media) => media.durationSeconds ?? 0
      )
    );
    const captured = session?.liveRecording?.recordedSeconds ?? 0;
    const metadataDuration = session?.videoDurationSeconds ?? 0;

    // A completed local VOD has been probed from the actual file and should
    // beat stale platform/live-span metadata. Active streams still grow.
    if (!isLive && localDuration > 0) return localDuration;
    return Math.max(localDuration, captured, metadataDuration, 0);
  }, [isLive, session]);

  const playbackUrl = useMemo(() => {
    const media = session?.sourceMedia?.[0];
    return (
      media?.previewVideoUrl ??
      (media?.sourceIsPlayableMp4 ? media.sourceVideoUrl : null) ??
      null
    );
  }, [session]);

  const streamEnded =
    !isLive ||
    session?.liveRecording?.status === "completed" ||
    session?.liveStatus === "post_live" ||
    session?.liveStatus === "completed";

  const transcriptionBehind =
    recordedSeconds > 5 && transcribedSeconds < recordedSeconds - 15;

  // Caught up with the recording — do NOT also require MIN_TRANSCRIPT_SECONDS here.
  // That blocked short VODs at 100% forever (e.g. 40s stream needs 45s to "catch up").
  const transcriptionCaughtUp =
    recordedSeconds > 0 &&
    transcribedSeconds >= recordedSeconds * 0.92;

  const transcriptReady =
    (transcribedSeconds >= MIN_TRANSCRIPT_SECONDS &&
      (searchableChunks >= MIN_SEARCHABLE_CHUNKS || transcriptionCaughtUp)) ||
    // Short VODs / thin transcripts: once we're caught up, proceed anyway.
    (transcriptionCaughtUp &&
      (searchableChunks >= 1 ||
        recordedSeconds < MIN_TRANSCRIPT_SECONDS ||
        transcribedSeconds >= Math.min(recordedSeconds, 20)));

  // Keep the "finding" phase visible until clips arrive or we have a hard error.
  // (Previously suggestRequested flipped finding off while the request was still
  // in-flight or after a soft empty/stale state, which looked like a 100% hang.)
  const findingClips =
    suggesting ||
    (transcriptReady &&
      visibleClips.length === 0 &&
      !transcriptionError &&
      !suggestionError &&
      !wizard.suggestRequested);

  const awaitingSuggestRetry =
    transcriptReady &&
    visibleClips.length === 0 &&
    wizard.suggestRequested &&
    !suggesting &&
    !transcriptionError &&
    !suggestionError;

  const needsCadenceChoice = Boolean(session && isLive && !wizard.cadence);

  const runSuggest = useCallback(
    async (opts?: {
      extra?: number;
      limit?: number;
      throughSeconds?: number;
    }): Promise<boolean> => {
      if (opts?.extra) setGetMoreLoading(true);
      else setSuggesting(true);
      setSuggestionError(null);
      try {
        const through = opts?.throughSeconds ?? transcribedSeconds;
        const { ok, data } = await fetchJson<{
          clips?: ClipSuggestionData[];
          wizard?: AgentWizardState;
          created?: number;
          error?: string;
          emptyReason?: string;
        }>(`/api/sessions/${sessionId}/suggest-clips`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(opts?.extra
              ? { extra: opts.extra }
              : { limit: opts?.limit ?? 10 }),
            throughSeconds: through,
            ...(wizard.cadence === "live_now"
              ? { cap: LIVE_NOW_SUGGESTION_CAP }
              : {}),
          }),
        });
        if (!ok) throw new Error(data.error ?? "Suggest failed");
        const nextClips = data.clips ?? [];
        setClips(nextClips);
        if (data.wizard) setWizard(data.wizard);
        else {
          await persistWizard({
            step: "pick",
            suggestRequested: true,
            lastSuggestThroughSeconds: through,
          });
        }
        if (nextClips.length === 0) {
          throw new Error(
            data.emptyReason ??
              "No usable speech was found for clip suggestions. Check the transcript, then try again."
          );
        }
        if ((data.created ?? 0) > 0) {
          setNewClipNotice(true);
          window.setTimeout(() => setNewClipNotice(false), 5000);
        }
        setTimeout(() => void loadSession().catch(() => {}), 2500);
        return true;
      } catch (err) {
        setSuggestionError(
          err instanceof Error ? err.message : "Failed to suggest clips"
        );
        return false;
      } finally {
        setSuggesting(false);
        setGetMoreLoading(false);
      }
    },
    [
      sessionId,
      persistWizard,
      loadSession,
      transcribedSeconds,
      wizard.cadence,
    ]
  );

  useEffect(() => {
    if (!findingClips) {
      setFindingElapsedSec(0);
      return;
    }
    const started = Date.now();
    setFindingElapsedSec(0);
    const id = window.setInterval(() => {
      setFindingElapsedSec(Math.max(0, Math.floor((Date.now() - started) / 1000)));
    }, 1000);
    return () => window.clearInterval(id);
  }, [findingClips]);

  // VOD sessions get vod_batch automatically; live waits for the chooser.
  useEffect(() => {
    if (!session || loading || wizard.cadence) return;
    if (isLive) return;
    void persistWizard({ cadence: "vod_batch" });
  }, [session, loading, wizard.cadence, isLive, persistWizard]);

  async function chooseCadence(
    cadence: Extract<AgentCadence, "live_now" | "after_stream">
  ) {
    await persistWizard({ cadence, step: "transcribing" });
    posthog.capture("agent_cadence_chosen", {
      session_id: sessionId,
      cadence,
    });
  }

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
          recordedSeconds?: number;
          searchableChunks?: number;
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

        // Agent transcription returns its readiness aggregate in the same response.
        if (typeof data.searchableChunks === "number") {
          setSearchableChunks(data.searchableChunks);
        }
        if (Date.now() - lastSessionRefreshAt.current >= 10_000) {
          lastSessionRefreshAt.current = Date.now();
          void loadSession().catch(() => {});
        }
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

  useEffect(() => {
    if (!wizard.cadence) return;
    if (wizard.cadence === "after_stream" && !streamEnded) return;
    if (!transcriptReady) return;
    if (transcriptionError || suggestionError) return;

    if (wizard.cadence === "live_now") {
      const last = wizard.lastSuggestThroughSeconds ?? 0;
      const needFirst = !wizard.suggestRequested;
      const needRoll =
        wizard.suggestRequested &&
        transcribedSeconds - last >= LIVE_NOW_ROLL_SECONDS;
      if (!needFirst && !needRoll) return;
      if (rollingInFlight.current || suggesting || getMoreLoading) return;

      if (visibleClips.length >= LIVE_NOW_SUGGESTION_CAP) return;

      rollingInFlight.current = true;
      void runSuggest({
        ...(needFirst ? { limit: 6 } : { extra: 4 }),
        throughSeconds: transcribedSeconds,
      }).finally(() => {
        rollingInFlight.current = false;
      });
      return;
    }

    // vod_batch or after_stream (stream ended)
    if (suggesting || getMoreLoading) return;
    if (wizard.suggestRequested) {
      const last = wizard.lastSuggestThroughSeconds ?? 0;
      const newCoverage = transcribedSeconds - last;
      const shouldRoll =
        visibleClips.length < 10 &&
        (newCoverage >= VOD_SUGGEST_ROLL_SECONDS ||
          (transcriptionCaughtUp && newCoverage >= 2));
      if (!shouldRoll || rollingInFlight.current) return;

      rollingInFlight.current = true;
      void runSuggest({
        extra: Math.min(5, Math.max(1, 10 - visibleClips.length)),
        throughSeconds: transcribedSeconds,
      }).finally(() => {
        rollingInFlight.current = false;
      });
      return;
    }

    if (visibleClips.length >= 10) {
      if (!wizard.suggestRequested) {
        void persistWizard({
          step: "pick",
          suggestRequested: true,
          lastSuggestThroughSeconds: transcribedSeconds,
        });
      }
      return;
    }

    if (suggestStarted.current) return;

    suggestStarted.current = true;
    void runSuggest({ throughSeconds: transcribedSeconds }).then((ok) => {
      if (!ok) {
        suggestStarted.current = false;
        // Allow another attempt after clearing the sticky flag if it was set.
        void persistWizard({ suggestRequested: false });
      }
    });
  }, [
    wizard.cadence,
    wizard.suggestRequested,
    wizard.lastSuggestThroughSeconds,
    streamEnded,
    transcriptReady,
    transcriptionCaughtUp,
    transcribedSeconds,
    visibleClips.length,
    suggesting,
    getMoreLoading,
    transcriptionError,
    suggestionError,
    runSuggest,
    persistWizard,
  ]);

  // Watchdog: at ~100% transcript with no clips and no in-flight suggest, force a try.
  useEffect(() => {
    if (!wizard.cadence) return;
    if (wizard.cadence === "after_stream" && !streamEnded) return;
    if (!transcriptionCaughtUp || visibleClips.length > 0) return;
    if (
      suggesting ||
      getMoreLoading ||
      transcriptionError ||
      suggestionError
    ) {
      return;
    }

    const id = window.setTimeout(() => {
      if (suggestStarted.current || suggesting) return;
      suggestStarted.current = true;
      void (async () => {
        if (wizard.suggestRequested) {
          await persistWizard({
            step: "transcribing",
            suggestRequested: false,
          });
        }
        const ok = await runSuggest({ throughSeconds: transcribedSeconds });
        if (!ok) {
          suggestStarted.current = false;
          await persistWizard({ suggestRequested: false });
        }
      })();
    }, 2500);
    return () => window.clearTimeout(id);
  }, [
    wizard.cadence,
    wizard.suggestRequested,
    streamEnded,
    transcriptionCaughtUp,
    visibleClips.length,
    suggesting,
    getMoreLoading,
    transcriptionError,
    suggestionError,
    transcribedSeconds,
    runSuggest,
    persistWizard,
  ]);

  const activeClipId =
    wizard.selectedClipIds[wizard.queueIndex] ??
    [...selectedIds][wizard.queueIndex] ??
    null;
  const activeClip = clips.find((c) => c.id === activeClipId) ?? null;
  const studioClip = studioClipId
    ? clips.find((c) => c.id === studioClipId) ?? null
    : null;

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

  function toggleClip(clipId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(clipId)) next.delete(clipId);
      else next.add(clipId);
      return next;
    });
  }

  async function continueFromPick() {
    const ids = [...selectedIds];
    if (ids.length === 0) {
      alert("Select at least one clip to continue.");
      return;
    }
    // live_now keeps unselected suggestions around for later; batch modes reject them.
    const rejectOthers = wizard.cadence !== "live_now";
    const rejectedIds = rejectOthers
      ? clips.map((c) => c.id).filter((id) => !selectedIds.has(id))
      : [];
    await Promise.all([
      ...ids.map((id) =>
        fetchJson(`/api/clips/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "saved" }),
        })
      ),
      ...rejectedIds.map((id) =>
        fetchJson(`/api/clips/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "rejected" }),
        })
      ),
    ]);
    setClips((prev) =>
      prev.map((c) => {
        if (selectedIds.has(c.id)) return { ...c, status: "saved" };
        if (rejectOthers) return { ...c, status: "rejected" };
        return c;
      })
    );
    await persistWizard({
      step: "edit",
      selectedClipIds: ids,
      queueIndex: 0,
      lookPreset: "auto",
      faceAnalysisJobId: null,
    });
    setExportDoneUrl(null);
    setExportError(null);
    posthog.capture("agent_clips_picked", {
      session_id: sessionId,
      count: ids.length,
      cadence: wizard.cadence,
    });
  }

  async function continueFromEdit() {
    await persistWizard({
      step: "export",
      includeCaptions: wizard.includeCaptions,
    });
  }

  async function renderActiveClip() {
    if (!activeClip) return;
    setExporting(true);
    setExportError(null);
    setExportDoneUrl(null);
    posthog.capture("agent_clip_export", {
      session_id: sessionId,
      clip_id: activeClip.id,
      look_preset: wizard.lookPreset ?? "auto",
    });

    try {
      // Prefer the auto-prepared (or user-overridden) saved layout.
      const layoutRes = await fetchJson<{
        configuration?: {
          layout: string;
          faceAnalysisJobId?: string | null;
          faceSelection?: VerticalLayoutSelection["faceSelection"];
          settings?: Record<string, unknown>;
        } | null;
      }>(`/api/clips/${activeClip.id}/vertical-layout`);

      let selection: VerticalLayoutSelection;
      const config = layoutRes.ok ? layoutRes.data.configuration : null;
      if (config) {
        const base = defaultVerticalLayoutSelection();
        const settings = (config.settings ?? {}) as Partial<
          VerticalLayoutSelection
        >;
        selection = {
          ...base,
          ...settings,
          layout: (config.layout as VerticalLayoutSelection["layout"]) ?? "auto",
          faceAnalysisJobId: config.faceAnalysisJobId ?? undefined,
          faceSelection: config.faceSelection ?? { mode: "auto" },
          captions: {
            enabled: wizard.includeCaptions,
            position: settings.captions?.position ?? "lower",
          },
        };
      } else {
        selection = buildVerticalSelection(
          wizard.lookPreset ?? "auto",
          wizard.faceAnalysisJobId,
          wizard.includeCaptions
        );
      }

      const res = await fetch(`/api/clips/${activeClip.id}/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          includeCaptions: wizard.includeCaptions,
          dynamicPunchIn: wizard.dynamicPunchInEnabled,
          captionAppearance,
          format: "vertical",
          verticalLayout: selection,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Render failed");

      const url = data.downloadUrl ?? clipDownloadUrl(activeClip.id);
      setExportDoneUrl(url);
      setClips((prev) =>
        prev.map((c) =>
          c.id === activeClip.id ? { ...c, status: "rendered" } : c
        )
      );
      await triggerFileDownload(
        url,
        `${activeClip.title.slice(0, 40) || "short"}.mp4`
      );
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Render failed");
    } finally {
      setExporting(false);
    }
  }

  async function advanceQueue() {
    const nextIndex = wizard.queueIndex + 1;
    if (nextIndex >= wizard.selectedClipIds.length) {
      await persistWizard({ step: "done" });
      return;
    }
    await persistWizard({
      step: "edit",
      queueIndex: nextIndex,
      lookPreset: "auto",
      faceAnalysisJobId: null,
    });
    setExportDoneUrl(null);
    setExportError(null);
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
        error?: string;
      }>(`/api/sessions/${sessionId}/find-clip`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: text,
          autoRender: false,
          includeCaptions: wizard.includeCaptions,
          captionAppearance,
        }),
      });

      if (!ok && data.error) throw new Error(data.error);

      if (data.found === false || !data.clip) {
        setTurns((prev) => [
          ...prev,
          {
            id: `asst-${Date.now()}`,
            role: "assistant",
            text:
              data.answer ??
              "I couldn't find that moment yet. Try quoting words from the stream.",
          },
        ]);
        return;
      }

      const clip = data.clip;
      setClips((prev) => {
        const without = prev.filter((c) => c.id !== clip.id);
        return [clip, ...without];
      });
      setSelectedIds((prev) => new Set(prev).add(clip.id));
      setTurns((prev) => [
        ...prev,
        {
          id: `asst-${Date.now()}`,
          role: "assistant",
          text:
            data.answer ??
            `Found “${clip.title}” and added it to your pick list.`,
          clip,
        },
      ]);
      if (wizard.step === "pick" || wizard.step === "transcribing") {
        await persistWizard({ step: "pick", suggestRequested: true });
      } else if (!wizard.selectedClipIds.includes(clip.id)) {
        // Add custom finds into the edit/export queue when past pick.
        await persistWizard({
          selectedClipIds: [...wizard.selectedClipIds, clip.id],
        });
      }
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

  const stepOrder: AgentWizardStep[] = [
    "transcribing",
    "pick",
    "edit",
    "export",
    "done",
  ];

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
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--color-muted)]">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-semibold uppercase tracking-[0.12em] text-[var(--color-accent)]">
              Agent mode
              {wizard.cadence === "live_now"
                ? " · live"
                : wizard.cadence === "after_stream"
                  ? " · after stream"
                  : wizard.cadence === "vod_batch"
                    ? " · VOD"
                    : ""}
            </span>
            <span className="tabular-nums">
              {formatSeconds(transcribedSeconds)} transcribed
              {recordedSeconds > 0
                ? ` · ${formatSeconds(recordedSeconds)} ${isLive ? "captured" : "total"}`
                : ""}
            </span>
            {findingClips && (
              <span className="flex items-center gap-1.5 text-[var(--color-accent)]">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-accent)]" />
                Finding clips
                {findingElapsedSec > 0 ? ` · ${findingElapsedSec}s` : ""}
              </span>
            )}
            {!findingClips &&
              transcriptionCaughtUp &&
              !transcriptReady &&
              visibleClips.length === 0 && (
              <span className="flex items-center gap-1.5 text-[var(--color-accent)]">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-accent)]" />
                Preparing transcript…
              </span>
            )}
            {!findingClips &&
              !transcriptionCaughtUp &&
              (transcribingActive || transcriptionBehind) && (
              <span className="flex items-center gap-1.5 text-[var(--color-accent)]">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-accent)]" />
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
            {suggestionError && !sourceError && !transcriptionError && (
              <span className="text-[var(--color-warning,#e6b84d)]">
                {suggestionError}
              </span>
            )}
          </div>
          {findingClips ? (
            <span className="font-semibold text-[var(--color-accent)]">
              Working…
            </span>
          ) : (
            recordedSeconds > 0 && (
              <span className="tabular-nums font-semibold text-[var(--color-foreground)]">
                {progressPct}%
              </span>
            )
          )}
        </div>
        <div
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#141414]"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={findingClips ? undefined : progressPct}
          aria-label={
            findingClips ? "Finding top clips" : "Transcription progress"
          }
        >
          {findingClips ? (
            <div className="relative h-full w-full">
              <div className="absolute inset-0 bg-[var(--color-accent)]/25" />
              <div className="absolute inset-y-0 w-2/5 animate-[agent-indeterminate_1.35s_ease-in-out_infinite] rounded-full bg-[var(--color-accent)]" />
            </div>
          ) : (
            <div
              className="h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-500"
              style={{ width: `${progressPct}%` }}
            />
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {stepOrder.map((step) => {
            const active = wizard.step === step;
            const idx = stepOrder.indexOf(wizard.step);
            const stepIdx = stepOrder.indexOf(step);
            const done = stepIdx < idx;
            const canJump =
              step !== "transcribing" &&
              step !== "done" &&
              stepIdx <= idx &&
              (step === "pick"
                ? wizard.suggestRequested || visibleClips.length > 0
                : wizard.selectedClipIds.length > 0);
            const className = cn(
              "rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide",
              active
                ? "bg-[var(--color-accent)] text-black"
                : done
                  ? "bg-[#1a2418] text-[var(--color-accent)]"
                  : "bg-[#141414] text-[var(--color-muted)]",
              canJump && !active && "cursor-pointer hover:ring-1 hover:ring-[var(--color-accent)]"
            );
            if (canJump && !active) {
              return (
                <button
                  key={step}
                  type="button"
                  className={className}
                  onClick={() => void persistWizard({ step })}
                >
                  {STEP_LABELS[step]}
                </button>
              );
            }
            return (
              <span key={step} className={className}>
                {STEP_LABELS[step]}
              </span>
            );
          })}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto p-4">
          {needsCadenceChoice && (
            <AgentCadenceChooser onChoose={(c) => void chooseCadence(c)} />
          )}

          {!needsCadenceChoice &&
            wizard.cadence === "after_stream" &&
            !streamEnded && (
            <div className="mx-auto flex w-full max-w-lg flex-col items-center justify-center gap-5 py-16 text-center">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--color-accent)] border-t-transparent" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-[var(--color-foreground)]">
                  Recording &amp; transcribing…
                </p>
                <p className="text-xs text-[var(--color-muted)]">
                  Clips unlock when the stream ends. We&apos;ll propose about 10
                  moments automatically.
                </p>
              </div>
              <TranscriptionProgressCard
                transcribedSeconds={transcribedSeconds}
                recordedSeconds={recordedSeconds}
                progressPct={progressPct}
                isLive={isLive}
                transcriptionError={transcriptionError}
                phase="transcribing"
              />
            </div>
          )}

          {!needsCadenceChoice &&
            !(wizard.cadence === "after_stream" && !streamEnded) &&
            visibleClips.length === 0 &&
            (wizard.step === "transcribing" || wizard.step === "pick") &&
            (findingClips ||
              !transcriptReady ||
              Boolean(transcriptionError) ||
              Boolean(suggestionError) ||
              suggesting) &&
            !(awaitingSuggestRetry && !transcriptionError && !suggestionError) && (
            <div className="mx-auto flex w-full max-w-lg flex-col items-center justify-center gap-5 py-16 text-center">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--color-accent)] border-t-transparent" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-[var(--color-foreground)]">
                  {findingClips || suggesting
                    ? "Finding your top clips…"
                    : transcriptionCaughtUp && !transcriptReady
                      ? "Transcription at 100% — finishing searchable text…"
                      : transcriptionCaughtUp
                        ? "Transcription complete — starting clip search…"
                        : "Transcribing your stream…"}
                </p>
                <p className="text-xs text-[var(--color-muted)]">
                  {findingClips || suggesting
                    ? "Transcript is ready. Scoring moments from the transcript and audio — usually under a minute."
                    : transcriptionCaughtUp && !transcriptReady
                      ? "The bar is full, but we still need a bit of searchable transcript before suggesting clips."
                      : wizard.cadence === "live_now"
                      ? `Once we have about ${formatDuration(MIN_TRANSCRIPT_SECONDS)} of searchable transcript, clip suggestions will start rolling in.`
                      : `Once we have about ${formatDuration(MIN_TRANSCRIPT_SECONDS)} of searchable transcript, we\u2019ll propose 10 clips automatically.`}
                </p>
              </div>
              <TranscriptionProgressCard
                transcribedSeconds={transcribedSeconds}
                recordedSeconds={recordedSeconds}
                progressPct={progressPct}
                isLive={isLive}
                transcriptionError={transcriptionError}
                phase={
                  findingClips || suggesting ? "finding_clips" : "transcribing"
                }
                findingElapsedSec={findingElapsedSec}
              />
              {!suggesting && (transcriptionError || suggestionError) && (
                <Button
                  type="button"
                  onClick={() => {
                    suggestStarted.current = false;
                    setTranscriptionError(null);
                    setSuggestionError(null);
                    void persistWizard({ suggestRequested: false });
                    void runSuggest({ throughSeconds: transcribedSeconds });
                  }}
                >
                  Retry finding clips
                </Button>
              )}
            </div>
          )}

          {!needsCadenceChoice &&
            wizard.step === "pick" &&
            !findingClips &&
            !suggesting &&
            (transcriptReady ||
              visibleClips.length > 0 ||
              wizard.suggestRequested) &&
            !(wizard.cadence === "after_stream" && !streamEnded) && (
            <div className="space-y-4">
              {newClipNotice && (
                <p className="rounded-lg border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-3 py-2 text-xs text-[var(--color-accent)]">
                  New clip suggestion
                  {wizard.cadence === "live_now" ? " — still watching the live stream" : ""}
                </p>
              )}
              {wizard.cadence === "live_now" && isLive && (
                <p className="text-xs text-[var(--color-muted)]">
                  Live suggestions update about every{" "}
                  {Math.round(LIVE_NOW_ROLL_SECONDS / 60)} minutes of new
                  transcript (up to {LIVE_NOW_SUGGESTION_CAP}). Select clips
                  anytime to edit and export.
                </p>
              )}
              <AgentClipPickGrid
                clips={withThumbnails(
                  sessionId,
                  visibleClips
                )}
                selectedIds={selectedIds}
                onToggle={toggleClip}
                onOpenClip={(id) => {
                  setStudioClipId(id);
                  setSelectedIds((prev) => new Set(prev).add(id));
                }}
                onGetMore={() =>
                  void runSuggest({
                    extra: 5,
                    throughSeconds: transcribedSeconds,
                  })
                }
                getMoreLoading={getMoreLoading}
                suggesting={suggesting}
                findingElapsedSec={findingElapsedSec}
              />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  className="text-xs text-[var(--color-accent)] hover:underline"
                  onClick={() => setShowFindChat((v) => !v)}
                >
                  {showFindChat ? "Hide find chat" : "Find another moment"}
                </button>
                <div className="flex flex-wrap gap-2">
                  {selectedIds.size === 1 && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        const id = [...selectedIds][0];
                        if (id) setStudioClipId(id);
                      }}
                    >
                      Open studio
                    </Button>
                  )}
                  <Button
                    type="button"
                    disabled={selectedIds.size === 0}
                    onClick={() => void continueFromPick()}
                  >
                    Batch wizard · {selectedIds.size || 0}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {wizard.step === "look" && activeClip && (
            <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-4 py-16 text-center">
              <p className="text-sm text-[var(--color-muted)]">
                Looks are applied automatically from face detection. Open a clip
                from Pick to change the look, or continue editing.
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void persistWizard({ step: "pick" })}
                >
                  Back to picks
                </Button>
                <Button
                  type="button"
                  onClick={() =>
                    void persistWizard({
                      step: "edit",
                      lookPreset: wizard.lookPreset ?? "auto",
                    })
                  }
                >
                  Continue to edit
                </Button>
              </div>
            </div>
          )}

          {wizard.step === "edit" && activeClip && (
            <div className="mx-auto w-full max-w-4xl space-y-4">
              <AgentClipEditor
                sessionId={sessionId}
                clip={activeClip}
                playbackUrl={playbackUrl}
                sourceDuration={recordedSeconds}
                includeCaptions={wizard.includeCaptions}
                onIncludeCaptionsChange={(value) => {
                  void persistWizard({ includeCaptions: value });
                }}
                dynamicPunchInEnabled={wizard.dynamicPunchInEnabled}
                onDynamicPunchInChange={(value) => {
                  void persistWizard({ dynamicPunchInEnabled: value });
                }}
                captionAppearance={captionAppearance}
                onCaptionAppearanceChange={(next) => {
                  setCaptionAppearance(next);
                  writeCaptionAppearancePreference(next);
                }}
                onClipChange={(next) => {
                  setClips((prev) =>
                    prev.map((c) => (c.id === next.id ? next : c))
                  );
                }}
              />
              <div className="flex justify-between gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void persistWizard({ step: "pick" })}
                >
                  Back to picks
                </Button>
                <Button type="button" onClick={() => void continueFromEdit()}>
                  Continue to export
                </Button>
              </div>
            </div>
          )}

          {wizard.step === "export" && activeClip && (
            <div className="mx-auto w-full max-w-lg space-y-4 rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)] p-6">
              <h2 className="text-lg font-semibold">Export</h2>
              <p className="text-sm text-[var(--color-muted)]">
                Render “{activeClip.title}” as a vertical Short with auto face
                positioning
                {wizard.includeCaptions ? " and captions" : ""}. Change the look
                anytime by opening the clip from Pick.
              </p>
              {exportError && (
                <p className="text-sm text-[var(--color-danger)]">{exportError}</p>
              )}
              {exportDoneUrl && (
                <p className="text-sm text-[var(--color-accent)]">
                  Render ready — download started.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void persistWizard({ step: "edit" })}
                >
                  Back to edit
                </Button>
                <Button
                  type="button"
                  disabled={exporting}
                  onClick={() => void renderActiveClip()}
                >
                  {exporting ? "Rendering…" : exportDoneUrl ? "Render again" : "Render & download"}
                </Button>
                {exportDoneUrl && (
                  <Button type="button" onClick={() => void advanceQueue()}>
                    {wizard.queueIndex + 1 >= wizard.selectedClipIds.length
                      ? "Finish"
                      : "Next clip"}
                  </Button>
                )}
              </div>
            </div>
          )}

          {wizard.step === "done" && (
            <div className="mx-auto flex max-w-lg flex-col items-center gap-4 py-16 text-center">
              <h2 className="text-xl font-semibold">All set</h2>
              <p className="text-sm text-[var(--color-muted)]">
                You finished the selected clips. Pick more from the grid or find
                another moment.
              </p>
              <Button
                type="button"
                onClick={() =>
                  void persistWizard({
                    step: "pick",
                    queueIndex: 0,
                    lookPreset: null,
                    faceAnalysisJobId: null,
                  })
                }
              >
                Back to clip picks
              </Button>
            </div>
          )}

          {(showFindChat || wizard.step === "pick") && showFindChat && (
            <div className="mt-6 overflow-hidden rounded-xl border border-[var(--color-card-border)]">
              <div className="relative max-h-72 min-h-[200px]">
                <ChatContainerRoot className="h-full px-3">
                  <ChatContainerContent className="space-y-4 py-4">
                    {turns.length === 0 && (
                      <Message>
                        <MessageAvatar src="" alt="Clipper" fallback="C" />
                        <MessageContent className="bg-secondary text-sm text-secondary-foreground">
                          Describe a moment to add another clip to your list.
                        </MessageContent>
                      </Message>
                    )}
                    {turns.map((turn) =>
                      turn.role === "user" ? (
                        <Message key={turn.id} className="justify-end">
                          <MessageContent className="bg-primary text-primary-foreground">
                            {turn.text}
                          </MessageContent>
                        </Message>
                      ) : (
                        <Message key={turn.id}>
                          <MessageAvatar src="" alt="Agent" fallback="AI" />
                          <MessageContent
                            className={cn(
                              "text-sm",
                              turn.error
                                ? "border border-destructive/40 bg-[#1a0808] text-[#ffb4b4]"
                                : "bg-secondary text-secondary-foreground"
                            )}
                          >
                            {turn.text}
                          </MessageContent>
                        </Message>
                      )
                    )}
                    <ChatContainerScrollAnchor />
                  </ChatContainerContent>
                </ChatContainerRoot>
              </div>
              <div className="border-t border-[var(--color-card-border)] p-3">
                <PromptInput
                  value={prompt}
                  onValueChange={setPrompt}
                  isLoading={sending}
                  onSubmit={() => void handleSend()}
                  className="border-border bg-card"
                >
                  <PromptInputTextarea placeholder="Describe the clip…" />
                  <PromptInputActions className="justify-end pt-1">
                    <PromptInputAction tooltip="Send">
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
            </div>
          )}
        </section>

        <aside className="hidden min-h-0 w-[300px] shrink-0 flex-col border-l border-[var(--color-card-border)] lg:flex">
          <div className="border-b border-[var(--color-card-border)] px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8f9b89]">
              Queue
            </p>
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
            {wizard.selectedClipIds.length === 0 ? (
              <p className="text-xs text-[var(--color-muted)]">
                Selected clips appear here.
              </p>
            ) : (
              wizard.selectedClipIds.map((id, index) => {
                const clip = clips.find((c) => c.id === id);
                if (!clip) return null;
                return (
                  <div
                    key={id}
                    className={cn(
                      "rounded-lg border p-2 text-xs",
                      index === wizard.queueIndex
                        ? "border-[var(--color-accent)]"
                        : "border-[var(--color-card-border)]"
                    )}
                  >
                    <p className="font-medium line-clamp-2">{clip.title}</p>
                    <p className="mt-1 text-[10px] text-[var(--color-muted)]">
                      {clip.status}
                    </p>
                  </div>
                );
              })
            )}
            {activeClip && wizard.step !== "pick" && (
              <ClipSuggestionCard
                clip={activeClip}
                canRender={false}
                includeCaptions={wizard.includeCaptions}
                captionAppearance={captionAppearance}
                onUpdate={(next) => {
                  setClips((prev) =>
                    prev.map((c) => (c.id === next.id ? next : c))
                  );
                }}
              />
            )}
          </div>
        </aside>
      </div>

      {studioClip && (
        <AgentClipStudioModal
          open={Boolean(studioClipId)}
          sessionId={sessionId}
          clip={studioClip}
          playbackUrl={playbackUrl}
          sourceDuration={recordedSeconds}
          includeCaptions={wizard.includeCaptions}
          dynamicPunchInEnabled={wizard.dynamicPunchInEnabled}
          captionAppearance={captionAppearance}
          onIncludeCaptionsChange={(value) => {
            void persistWizard({ includeCaptions: value });
          }}
          onDynamicPunchInChange={(value) => {
            void persistWizard({ dynamicPunchInEnabled: value });
          }}
          onCaptionAppearanceChange={(next) => {
            setCaptionAppearance(next);
            writeCaptionAppearancePreference(next);
          }}
          onClipChange={(next) => {
            setClips((prev) =>
              prev.map((c) => (c.id === next.id ? next : c))
            );
          }}
          onClose={() => setStudioClipId(null)}
        />
      )}
    </div>
  );
}

function buildVerticalSelection(
  presetId: ContentLookPresetId,
  faceAnalysisJobId: string | null,
  captionsEnabled: boolean
): VerticalLayoutSelection {
  const preset = getContentLookPreset(presetId);
  const base = defaultVerticalLayoutSelection();
  return {
    ...base,
    layout: preset.layout,
    faceAnalysisJobId: faceAnalysisJobId ?? undefined,
    faceSelection: { mode: "auto" },
    stacked: {
      ...base.stacked,
      facecamPosition: "top",
      hideOriginalFacecam: presetId === "gaming" ? "blur" : "none",
    },
    pip: {
      ...base.pip,
      hideOriginalFacecam: presetId === "podcast" ? "blur" : "none",
    },
    captions: {
      enabled: captionsEnabled,
      position: "lower",
    },
  };
}

const FINDING_CLIP_TIPS = [
  "Scoring punchy moments…",
  "Ranking by clip-worthiness…",
  "Picking titles and thumbnails…",
  "Almost there…",
] as const;

function TranscriptionProgressCard({
  transcribedSeconds,
  recordedSeconds,
  progressPct,
  isLive,
  transcriptionError,
  phase = "transcribing",
  findingElapsedSec = 0,
}: {
  transcribedSeconds: number;
  recordedSeconds: number;
  progressPct: number;
  isLive: boolean;
  transcriptionError: string | null;
  phase?: "transcribing" | "finding_clips";
  findingElapsedSec?: number;
}) {
  const finding = phase === "finding_clips";
  const txDone = finding || progressPct >= 92;
  const tipIndex =
    findingElapsedSec > 0
      ? Math.floor(findingElapsedSec / 4) % FINDING_CLIP_TIPS.length
      : 0;

  return (
    <div className="w-full space-y-3 rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)] px-4 py-4 text-left">
      <ol className="space-y-2">
        <li className="flex items-start gap-2.5 text-sm">
          <span
            className={cn(
              "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
              txDone
                ? "bg-[var(--color-accent)] text-black"
                : "border border-[var(--color-card-border)] text-[var(--color-muted)]"
            )}
          >
            {txDone ? "✓" : "1"}
          </span>
          <span>
            <span
              className={cn(
                "font-medium",
                txDone
                  ? "text-[var(--color-muted)]"
                  : "text-[var(--color-foreground)]"
              )}
            >
              {txDone ? "Transcription complete" : "Transcribing stream"}
            </span>
            {!finding && (
              <span className="mt-0.5 block text-xs tabular-nums text-[var(--color-muted)]">
                {formatSeconds(transcribedSeconds)}
                {recordedSeconds > 0
                  ? ` of ${formatSeconds(recordedSeconds)}${
                      isLive ? " captured" : ""
                    }`
                  : ""}
                {recordedSeconds > 0 ? ` · ${progressPct}%` : ""}
              </span>
            )}
          </span>
        </li>
        <li className="flex items-start gap-2.5 text-sm">
          <span
            className={cn(
              "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
              finding
                ? "border border-[var(--color-accent)] text-[var(--color-accent)]"
                : "border border-[var(--color-card-border)] text-[var(--color-muted)]"
            )}
          >
            {finding ? (
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-accent)]" />
            ) : (
              "2"
            )}
          </span>
          <span>
            <span
              className={cn(
                "font-medium",
                finding
                  ? "text-[var(--color-foreground)]"
                  : "text-[var(--color-muted)]"
              )}
            >
              {finding ? "Finding top clips…" : "Find top clips"}
            </span>
            {finding && (
              <span className="mt-0.5 block text-xs text-[var(--color-muted)]">
                {FINDING_CLIP_TIPS[tipIndex]}
                {findingElapsedSec > 0
                  ? ` · ${findingElapsedSec}s elapsed`
                  : ""}
              </span>
            )}
          </span>
        </li>
      </ol>

      <div
        className="h-2.5 overflow-hidden rounded-full bg-[#141814]"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={finding ? undefined : progressPct}
        aria-label={finding ? "Finding top clips" : "Transcription progress"}
      >
        {finding ? (
          <div className="relative h-full w-full">
            <div className="absolute inset-0 bg-[var(--color-accent)]/20" />
            <div className="absolute inset-y-0 w-2/5 animate-[agent-indeterminate_1.35s_ease-in-out_infinite] rounded-full bg-[var(--color-accent)]" />
          </div>
        ) : (
          <div
            className="h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-500 ease-out"
            style={{
              width: `${
                recordedSeconds > 0
                  ? progressPct
                  : Math.min(8, transcribedSeconds > 0 ? 4 : 2)
              }%`,
            }}
          />
        )}
      </div>

      <p className="text-[11px] text-[var(--color-muted)]">
        {finding
          ? "Still working — this step has no percent. Hang tight, clips appear when scoring finishes."
          : recordedSeconds > 0
            ? isLive
              ? "Live capture keeps growing; the bar is transcript vs captured so far."
              : "Bar is transcribed time vs full stream length."
            : isLive
              ? "Waiting for capture…"
              : "Measuring length…"}
      </p>

      {transcriptionError && (
        <p className="text-[11px] text-[var(--color-warning,#e6b84d)]">
          {transcriptionError}
        </p>
      )}
    </div>
  );
}
