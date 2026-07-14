"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import { EditorHeader } from "@/components/layout/EditorHeader";
import { VideoPreview } from "@/components/VideoPreview";
import type { StreamPlayerHandle } from "@/types/streamPlayer";
import type { StreamPlatform, StreamEmbedInfo } from "@/lib/streamPlatform";
import { shouldPreferLocalVideoPreview } from "@/lib/streamPlatform";
import { LiveTimeline, type ClipSelection } from "@/components/LiveTimeline";
import { LIVE_TICK_MS, LIVE_SEGMENT_SECONDS } from "@/lib/timelineConstants";
import { THUMB_POLL_MS } from "@/lib/thumbnailConstants";
import {
  TRANSCRIPTION_FAST_TICK_MS,
  TRANSCRIPTION_SLOW_TICK_MS,
} from "@/lib/transcriptionConstants";
import { buildLiveTimelineSegments } from "@/lib/timelineSegments";
import { SidebarPanel } from "@/components/SidebarPanel";
import { fetchJson } from "@/lib/apiClient";
import {
  readCaptionsEnabledPreference,
  writeCaptionsEnabledPreference,
} from "@/lib/captionStyles";
import {
  readCaptionAppearancePreference,
  writeCaptionAppearancePreference,
  type CaptionAppearance,
} from "@/lib/captionAppearance";
import {
  buildAudioSpikeMarkers,
  selectAudioSpikesForTimeline,
  type AudioSpikeMarker,
} from "@/lib/audioSpikeTimeline";
import {
  mergeCaptionEdit,
  type CaptionEditsMap,
} from "@/lib/captionEdits";
import {
  coalesceTimelineSeconds,
  sanitizeDurationSeconds,
  sanitizeStreamStartDate,
} from "@/lib/timelineBounds";
import type { MarkerKind, TimelineMarker } from "@/lib/editorState";
import { SourceUploadFallback } from "@/components/SourceUploadFallback";
import {
  beginPaneResize,
  useEditorLayoutPrefs,
} from "@/lib/editorLayoutPrefs";

interface SessionData {
  id: string;
  platform?: StreamPlatform;
  youtubeVideoId: string;
  youtubeUrl?: string | null;
  title?: string | null;
  liveStatus?: string | null;
  activeLiveChatId?: string | null;
  actualStartTime?: string | null;
  videoDurationSeconds?: number;
  streamEmbed?: StreamEmbedInfo;
  liveRecording?: { status: string; recordedSeconds: number } | null;
  sourceMedia?: Array<{
    durationSeconds?: number | null;
    isLiveRecording?: boolean;
    sourceVideoUrl?: string | null;
    previewVideoUrl?: string | null;
    sourceIsPlayableMp4?: boolean;
  }>;
  storageLabel?: string;
}

interface SessionWorkspaceProps {
  sessionId: string;
}

function timelineThumbsEqual(
  prev: Array<{ startTimeSeconds: number; endTimeSeconds: number; url: string }>,
  next: Array<{ startTimeSeconds: number; endTimeSeconds: number; url: string }>
) {
  return (
    next.length === prev.length &&
    next.every(
      (t, i) =>
        t.startTimeSeconds === prev[i]?.startTimeSeconds &&
        t.endTimeSeconds === prev[i]?.endTimeSeconds &&
        t.url === prev[i]?.url
    )
  );
}

function markerKindFromEvent(type: string): MarkerKind {
  const normalized = type.toLowerCase();
  if (normalized.includes("laugh") || normalized.includes("funny")) return "laughter";
  if (normalized.includes("chat")) return "chat";
  if (normalized.includes("topic")) return "topic";
  return "hype";
}

function transcriptRevision(
  chunks: Array<{
    id: string;
    startTimeSeconds: number;
    endTimeSeconds: number;
    text: string;
  }>
): string {
  let hash = 2166136261;
  const mix = (value: number) => {
    hash ^= value;
    hash = Math.imul(hash, 16777619);
  };
  for (const chunk of chunks) {
    mix(Math.round(chunk.startTimeSeconds * 1000));
    mix(Math.round(chunk.endTimeSeconds * 1000));
    for (let index = 0; index < chunk.id.length; index++) {
      mix(chunk.id.charCodeAt(index));
    }
    for (let index = 0; index < chunk.text.length; index++) {
      mix(chunk.text.charCodeAt(index));
    }
  }
  return `${chunks.length}:${hash >>> 0}`;
}

export function SessionWorkspace({ sessionId }: SessionWorkspaceProps) {
  const router = useRouter();
  const [session, setSession] = useState<SessionData | null>(null);
  const [transcripts, setTranscripts] = useState<
    Array<{
      id: string;
      startTimeSeconds: number;
      endTimeSeconds: number;
      text: string;
      rawJson?: unknown;
    }>
  >([]);
  const [clipSelection, setClipSelection] = useState<ClipSelection>({
    start: 0,
    end: LIVE_SEGMENT_SECONDS,
  });
  const [thumbnails, setThumbnails] = useState<
    Array<{ startTimeSeconds: number; endTimeSeconds: number; url: string }>
  >([]);
  const [newSegmentIds, setNewSegmentIds] = useState<Set<string>>(new Set());
  const prevTranscriptIds = useRef<Set<string>>(new Set());
  const [currentTime, setCurrentTime] = useState(0);
  const [playerDuration, setPlayerDuration] = useState(0);
  const handlePlayerDurationChange = useCallback((duration: number) => {
    setPlayerDuration(sanitizeDurationSeconds(duration));
  }, []);

  const handlePlayerTimeUpdate = useCallback((time: number) => {
    setCurrentTime(time);
  }, []);
  const [liveClock, setLiveClock] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [transcriptionError, setTranscriptionError] = useState<string | null>(null);
  const [sourcePreparationError, setSourcePreparationError] = useState<string | null>(null);
  const [transcribingActive, setTranscribingActive] = useState(false);
  const [captionsEnabled, setCaptionsEnabled] = useState(true);
  const [captionAppearance, setCaptionAppearance] = useState<CaptionAppearance>(
    readCaptionAppearancePreference
  );
  const [audioSpikes, setAudioSpikes] = useState<AudioSpikeMarker[]>([]);
  const [aiMarkers, setAiMarkers] = useState<TimelineMarker[]>([]);
  const [captionEdits, setCaptionEdits] = useState<CaptionEditsMap>({});
  const [assistantOpen, setAssistantOpen] = useState(false);
  const {
    monitorHeight,
    setMonitorHeight,
  } = useEditorLayoutPrefs();
  const captionSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playerRef = useRef<StreamPlayerHandle>(null);
  const sourceStarted = useRef(false);
  const transcribeInFlight = useRef(false);
  const eventsInFlight = useRef(false);
  const audioSyncInFlight = useRef(false);
  const thumbnailsInFlight = useRef(false);
  const transcriptSignature = useRef("");
  const captionRebuildAttempted = useRef(false);
  const sessionLoadedOnce = useRef(false);

  const seekTo = useCallback((seconds: number) => {
    playerRef.current?.seekTo(seconds, { play: true });
    setCurrentTime(seconds);
  }, []);

  const seekFromAssistant = useCallback((seconds: number) => {
    seekTo(seconds);
    setClipSelection({
      start: seconds,
      end: seconds + LIVE_SEGMENT_SECONDS,
    });
  }, [seekTo]);

  const scrubTo = useCallback((seconds: number) => {
    playerRef.current?.seekTo(seconds, { play: false });
    setCurrentTime(seconds);
  }, []);

  const pausePlayback = useCallback(() => {
    playerRef.current?.pause();
  }, []);

  async function loadThumbnails() {
    if (thumbnailsInFlight.current) return;
    thumbnailsInFlight.current = true;
    try {
      const res = await fetch(`/api/sessions/${sessionId}/timeline-thumbs`);
      const data = await res.json();
      if (!res.ok) return;
      const next = (data.thumbnails ?? []) as typeof thumbnails;
      setThumbnails((prev) => {
        if (timelineThumbsEqual(prev, next)) return prev;
        return next;
      });
    } catch {
      // optional
    } finally {
      thumbnailsInFlight.current = false;
    }
  }

  async function loadSession() {
    const isInitialLoad = !sessionLoadedOnce.current;
    try {
      const { ok, data } = await fetchJson<{ session?: SessionData; error?: string }>(
        `/api/sessions/${sessionId}`
      );
      if (!ok) throw new Error(data.error ?? "Failed to load session");
      if (!data.session) throw new Error("Session not found");
      setSession(data.session);
      sessionLoadedOnce.current = true;
    } catch (err) {
      // Background refresh failures (dev recompile blips) must not kill the editor.
      if (isInitialLoad) {
        setError(err instanceof Error ? err.message : "Failed to load");
      }
    } finally {
      setLoading(false);
    }
  }

  async function loadCaptionEdits() {
    try {
      const { ok, data } = await fetchJson<{ edits?: CaptionEditsMap }>(
        `/api/sessions/${sessionId}/captions`
      );
      if (ok) setCaptionEdits(data.edits ?? {});
    } catch {
      // non-fatal
    }
  }

  async function persistCaptionEdit(
    cueId: string,
    patch: Partial<{
      text: string;
      startTimeSeconds: number;
      endTimeSeconds: number;
    }>,
    immediate = false
  ) {
    const run = async () => {
      try {
        const { ok, data } = await fetchJson<{ edits?: CaptionEditsMap }>(
          `/api/sessions/${sessionId}/captions`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ cueId, ...patch }),
          }
        );
        if (ok && data.edits) setCaptionEdits(data.edits);
      } catch {
        // non-fatal
      }
    };

    if (immediate) {
      if (captionSaveTimer.current) clearTimeout(captionSaveTimer.current);
      await run();
      return;
    }

    if (captionSaveTimer.current) clearTimeout(captionSaveTimer.current);
    captionSaveTimer.current = setTimeout(() => {
      void run();
    }, 450);
  }

  const handleCaptionEdit = useCallback(
    (
      cueId: string,
      patch: Partial<{
        text: string;
        startTimeSeconds: number;
        endTimeSeconds: number;
      }>
    ) => {
      setCaptionEdits((prev) => mergeCaptionEdit(prev, cueId, patch));
      void persistCaptionEdit(cueId, patch, patch.text !== undefined);
    },
    [sessionId]
  );

  async function loadEvents() {
    if (eventsInFlight.current) return;
    eventsInFlight.current = true;
    try {
      if (!audioSyncInFlight.current) {
        audioSyncInFlight.current = true;
        void fetch(`/api/sessions/${sessionId}/audio/sync`, { method: "POST" })
          .catch(() => {})
          .finally(() => {
            audioSyncInFlight.current = false;
          });
      }

      const { ok, data } = await fetchJson<{
        transcriptChunks?: typeof transcripts;
        eventWindows?: Array<{
          id: string;
          startTimeSeconds: number;
          endTimeSeconds: number;
          type: string;
          score: number;
          summary?: string | null;
        }>;
        audioEvents?: Array<{
          id: string;
          startTimeSeconds: number;
          endTimeSeconds: number;
          type: string;
          score: number;
          summary?: string | null;
          rawData?: unknown;
        }>;
      }>(`/api/sessions/${sessionId}/events`);
      if (!ok) return;

      const chunks = data.transcriptChunks ?? [];
      setAiMarkers(
        (data.eventWindows ?? []).map((event) => ({
          id: `event-${event.id}`,
          timeSeconds: event.startTimeSeconds,
          endTimeSeconds: event.endTimeSeconds,
          label: event.summary?.trim() || event.type.replace(/_/g, " "),
          kind: markerKindFromEvent(event.type),
          score: event.score,
          source: "ai",
        }))
      );
      setAudioSpikes(
        selectAudioSpikesForTimeline(
          buildAudioSpikeMarkers(data.audioEvents ?? [])
        )
      );

      // Transcript text should paint independently of waveform generation.
      const nextTranscriptSignature = transcriptRevision(chunks);
      if (nextTranscriptSignature !== transcriptSignature.current) {
        transcriptSignature.current = nextTranscriptSignature;
        const arrived = new Set<string>();
        for (const chunk of chunks) {
          if (!prevTranscriptIds.current.has(chunk.id)) arrived.add(chunk.id);
        }
        prevTranscriptIds.current = new Set(chunks.map((chunk) => chunk.id));
        if (arrived.size > 0) {
          setNewSegmentIds(arrived);
          window.setTimeout(() => setNewSegmentIds(new Set()), 2500);
        }
        setTranscripts(chunks);
      }
    } catch {
      // non-fatal
    } finally {
      eventsInFlight.current = false;
    }
  }

  useEffect(() => {
    setCaptionsEnabled(readCaptionsEnabledPreference());
    setCaptionAppearance(readCaptionAppearancePreference());
  }, []);

  useEffect(() => {
    loadSession();
    loadEvents();
    void loadCaptionEdits();
    void loadThumbnails();
  }, [sessionId]);

  useEffect(() => {
    if (!session) return;
    const id = setInterval(() => void loadThumbnails(), THUMB_POLL_MS);
    return () => clearInterval(id);
  }, [sessionId, session?.id]);

  useEffect(() => {
    if (sourceStarted.current) return;
    sourceStarted.current = true;
    void fetchJson<{ error?: string }>(
      `/api/sessions/${sessionId}/download-source`,
      { method: "POST" }
    )
      .then(({ ok, data }) => {
        if (!ok) {
          setSourcePreparationError(
            data.error
              ? `Source download failed: ${data.error}`
              : "Source download failed on the server"
          );
          return;
        }
        setSourcePreparationError(null);
      })
      .catch((error) => {
        setSourcePreparationError(
          error instanceof Error
            ? `Source download failed: ${error.message}`
            : "Source download failed on the server"
        );
      });
  }, [sessionId]);

  const isLive =
    session?.liveStatus === "live" || session?.liveStatus === "upcoming";

  const transcribedSeconds = Math.max(
    0,
    ...transcripts
      .filter((t) => {
        const raw = t.rawJson as { whisper?: boolean; cursorOnly?: boolean } | null;
        return (
          raw?.whisper &&
          !raw?.cursorOnly &&
          t.text !== "[silence]" &&
          t.text !== "[processing error]"
        );
      })
      .map((t) => t.endTimeSeconds)
  );

  const recordedSecondsForTx = Math.max(
    session?.liveRecording?.recordedSeconds ?? 0,
    session?.sourceMedia?.[0]?.durationSeconds ?? 0,
    0
  );

  const transcriptionBehind =
    recordedSecondsForTx > 5 && transcribedSeconds < recordedSecondsForTx - 15;

  function transcriptsNeedTimingRebuild(
    chunks: typeof transcripts
  ): boolean {
    const whisper = chunks.filter((c) => {
      const m = c.rawJson as { whisper?: boolean } | null;
      return m?.whisper;
    });
    if (whisper.length === 0) return false;
    // A mixed transcript can contain new word-timed chunks plus older
    // OpenRouter/estimated chunks. Rebuild if *any* real speech chunk lacks
    // word timestamps; checking whether any one chunk had words left the rest
    // permanently approximate.
    return whisper.some(
      (c) => {
        const meta = c.rawJson as {
          words?: unknown[];
          estimatedTiming?: boolean;
          cursorOnly?: boolean;
        } | null;
        if (meta?.cursorOnly || c.text === "[silence]") return false;
        return (
          meta?.estimatedTiming === true ||
          !Array.isArray(meta?.words) ||
          meta.words.length === 0
        );
      }
    );
  }

  useEffect(() => {
    if (captionRebuildAttempted.current || transcripts.length === 0) return;
    if (!transcriptsNeedTimingRebuild(transcripts)) return;
    captionRebuildAttempted.current = true;
    fetch(`/api/sessions/${sessionId}/transcribe?rebuild=1`, { method: "POST" })
      .then(() => loadEvents())
      .catch(() => {});
  }, [sessionId, transcripts]);

  useEffect(() => {
    if (!session) return;

    async function liveTick() {
      try {
        await fetch(`/api/sessions/${sessionId}/live-tick`, { method: "POST" });
        await loadSession();
        await loadEvents();
        void loadThumbnails();
      } catch {
        // non-fatal
      }
    }

    liveTick();
    const interval = setInterval(liveTick, LIVE_TICK_MS);
    return () => clearInterval(interval);
  }, [sessionId, session?.id]);

  useEffect(() => {
    if (!session) return;

    async function runTranscribe() {
      if (transcribeInFlight.current) return;
      transcribeInFlight.current = true;
      setTranscribingActive(true);
      try {
        const { ok, data } = await fetchJson<{
          error?: string;
          reason?: string;
          skipped?: boolean;
          transcribedThrough?: number;
        }>(`/api/sessions/${sessionId}/transcribe`, { method: "POST" });

        if (!ok) {
          setTranscriptionError(data.error ?? "Transcription failed");
        } else if (data.reason === "no_file") {
          setTranscriptionError("Waiting for local recording to download...");
        } else if (data.reason === "no_openai_key") {
          setTranscriptionError(
            "Set OPENROUTER_API_KEY or OPENAI_API_KEY in .env"
          );
        } else if (data.reason === "too_short") {
          setTranscriptionError("Waiting for enough audio to transcribe...");
        } else if (data.reason === "audio_not_ready") {
          setTranscriptionError("Buffering capture — transcription will resume shortly");
        } else if (data.reason === "provider_unavailable") {
          const detail = data.error?.trim();
          setTranscriptionError(
            /quota/i.test(detail ?? "")
              ? "AI provider quota exceeded - add credits and transcription will resume automatically"
              : detail
                ? `Transcription unavailable (${detail}) - retrying automatically`
                : "AI provider unreachable - retrying automatically"
          );
        } else {
          setTranscriptionError(null);
        }

        await loadEvents();
        await loadSession();
      } catch (err) {
        setTranscriptionError(
          err instanceof Error ? err.message : "Transcription request failed"
        );
      } finally {
        transcribeInFlight.current = false;
        setTranscribingActive(false);
      }
    }

    runTranscribe();
    const ms = transcriptionBehind
      ? TRANSCRIPTION_FAST_TICK_MS
      : TRANSCRIPTION_SLOW_TICK_MS;
    const interval = setInterval(runTranscribe, ms);
    return () => clearInterval(interval);
  }, [sessionId, session?.id, transcriptionBehind, transcribedSeconds]);

  useEffect(() => {
    if (session?.liveStatus !== "live" && session?.liveStatus !== "upcoming") return;
    const id = setInterval(() => setLiveClock(Date.now()), 10_000);
    return () => clearInterval(id);
  }, [session?.liveStatus]);

  async function handleDeleteSession() {
    const size = session?.storageLabel ? ` (${session.storageLabel})` : "";
    if (
      !window.confirm(
        `Delete this session and free disk space${size}?\n\nRemoves local recordings, frames, and rendered clips.`
      )
    ) {
      return;
    }

    setDeleting(true);
    try {
      const { ok, data } = await fetchJson<{ error?: string; storageLabel?: string }>(
        `/api/sessions/${sessionId}`,
        { method: "DELETE" }
      );
      if (!ok) throw new Error(data.error ?? "Delete failed");
      posthog.capture("session_deleted", { session_id: sessionId });
      router.push("/");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Delete failed");
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="editor-shell min-h-screen flex flex-col bg-[var(--color-background)]">
        <EditorHeader title="Editor" />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-[var(--color-muted)] animate-pulse">Loading...</p>
        </div>
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="editor-shell min-h-screen flex flex-col bg-[var(--color-background)]">
        <EditorHeader title="Editor" />
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6">
          <p className="text-[var(--color-danger)]">{error ?? "Session not found"}</p>
          <Link href="/" className="text-[var(--color-accent)] text-sm hover:underline">
            Back to home
          </Link>
        </div>
      </div>
    );
  }

  const sourceMedia = session.sourceMedia?.[0];
  const platform: StreamPlatform = session.platform ?? "youtube";
  const streamEmbed = session.streamEmbed ?? {};
  const sourceVideoUrl = sourceMedia?.sourceVideoUrl ?? null;
  const previewVideoUrl = sourceMedia?.previewVideoUrl ?? null;
  const playbackVideoUrl =
    previewVideoUrl ??
    (sourceMedia?.sourceIsPlayableMp4 ? sourceVideoUrl : null);
  const preferLocalVideo = shouldPreferLocalVideoPreview({
    platform,
    previewVideoUrl,
    sourceVideoUrl,
    sourceIsPlayableMp4: sourceMedia?.sourceIsPlayableMp4,
    isLiveRecording: sourceMedia?.isLiveRecording,
    isLive,
    durationSeconds: sourceMedia?.durationSeconds,
    knownStreamDuration: session.videoDurationSeconds,
  });
  const recordedSeconds = coalesceTimelineSeconds([
    session.liveRecording?.recordedSeconds,
    sourceMedia?.durationSeconds,
    ...transcripts.map((t) => t.endTimeSeconds),
  ]);

  const streamStart = sanitizeStreamStartDate(
    session.actualStartTime ? new Date(session.actualStartTime) : null
  );
  const liveElapsedSeconds =
    streamStart && isLive
      ? sanitizeDurationSeconds(
          Math.max(0, (liveClock - streamStart.getTime()) / 1000)
        )
      : 0;

  const streamDuration = isLive
    ? coalesceTimelineSeconds([
        recordedSeconds,
        currentTime,
        playerDuration,
        liveElapsedSeconds,
        LIVE_SEGMENT_SECONDS,
      ])
    : coalesceTimelineSeconds([
        session.videoDurationSeconds,
        playerDuration,
        liveElapsedSeconds,
        recordedSeconds,
        currentTime,
        LIVE_SEGMENT_SECONDS,
      ]);

  const liveSegments = buildLiveTimelineSegments(
    transcripts.filter((t) => {
      const raw = t.rawJson as { cursorOnly?: boolean } | null;
      return !raw?.cursorOnly && t.text !== "[silence]" && t.text !== "[processing error]";
    }),
    recordedSeconds,
    newSegmentIds
  );

  const progressRecordedSeconds = coalesceTimelineSeconds([
    session.liveRecording?.recordedSeconds,
    sourceMedia?.durationSeconds,
  ]);
  const progressTranscribedSeconds = transcribedSeconds;

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

      <div className="relative flex-1 min-h-0">
        <div className="relative z-0 isolate flex h-full min-h-0 flex-col">
          {sourcePreparationError && recordedSeconds <= 0 && (
            <SourceUploadFallback
              sessionId={sessionId}
              message={sourcePreparationError}
              onUploaded={async () => {
                setSourcePreparationError(null);
                setTranscriptionError(null);
                await loadSession();
                void fetch(`/api/sessions/${sessionId}/transcribe`, {
                  method: "POST",
                }).finally(() => {
                  void loadEvents();
                  void loadThumbnails();
                });
              }}
            />
          )}

          {/* Program monitor — resizable, 16:9 video inside */}
          <div
            className="shrink-0 border-b border-[var(--color-card-border)]"
            style={{ height: monitorHeight }}
          >
            <VideoPreview
              platform={platform}
              sourceId={session.youtubeVideoId}
              embed={streamEmbed}
              playbackVideoUrl={
                playbackVideoUrl
                  ? `${playbackVideoUrl}${playbackVideoUrl.includes("?") ? "&" : "?"}v=${Math.floor(recordedSeconds / 12)}`
                  : null
              }
              streamPageUrl={session.youtubeUrl}
              recordedSeconds={recordedSeconds}
              preferLocalVideo={preferLocalVideo}
              playerRef={playerRef}
              transcripts={transcripts}
              captionsEnabled={captionsEnabled}
              captionEdits={captionEdits}
              captionAppearance={captionAppearance}
              onCaptionsEnabledChange={(enabled) => {
                setCaptionsEnabled(enabled);
                writeCaptionsEnabledPreference(enabled);
              }}
              onCaptionAppearanceChange={(appearance) => {
                setCaptionAppearance(appearance);
                writeCaptionAppearancePreference(appearance);
              }}
              onTimeUpdate={handlePlayerTimeUpdate}
              onDurationChange={handlePlayerDurationChange}
            />
          </div>

          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize preview"
            title="Drag to resize preview"
            className="group relative z-10 h-1.5 shrink-0 cursor-row-resize bg-[#0a100a] hover:bg-[var(--color-accent)]/40"
            onPointerDown={(event) =>
              beginPaneResize({
                axis: "row",
                startSize: monitorHeight,
                onResize: setMonitorHeight,
                event,
              })
            }
          >
            <span className="pointer-events-none absolute inset-x-0 -top-1 -bottom-1" />
          </div>

          {/* Timeline — primary work surface */}
          <div className="min-h-0 flex-1">
            <LiveTimeline
              sessionId={sessionId}
              segments={liveSegments}
              thumbnails={thumbnails}
              durationSeconds={streamDuration}
              recordedSeconds={recordedSeconds}
              currentTime={currentTime}
              isLive={isLive}
              selection={clipSelection}
              onSelectionChange={setClipSelection}
              onSeek={seekTo}
              onPause={pausePlayback}
              onScrub={scrubTo}
              onClipCreated={loadEvents}
              includeCaptions={captionsEnabled}
              captionChunks={transcripts}
              captionAppearance={captionAppearance}
              captionEdits={captionEdits}
              onCaptionEdit={handleCaptionEdit}
              audioSpikes={audioSpikes}
              aiMarkers={aiMarkers}
            />
          </div>
        </div>

        {/* Assistant drawer */}
        {!assistantOpen && (
          <button
            type="button"
            onClick={() => setAssistantOpen(true)}
            className="absolute bottom-3 right-3 z-10 flex items-center gap-2 border border-[var(--color-card-border)] bg-[#0a0f0a]/95 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#c5cfc0] shadow-lg backdrop-blur-sm transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
            aria-label="Open assistant"
          >
            {(transcribingActive || transcriptionBehind) && (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-accent)] animate-pulse" />
            )}
            Assistant
          </button>
        )}

        {assistantOpen && (
          <>
            <button
              type="button"
              aria-label="Close assistant"
              className="absolute inset-0 z-40 bg-black/50"
              aria-hidden="true"
              onClick={() => setAssistantOpen(false)}
            />
            <aside className="absolute bottom-0 right-0 top-0 z-50 flex w-[min(100%,360px)] flex-col border-l border-[var(--color-card-border)] bg-[#050705] shadow-2xl">
              <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-card-border)] bg-[#020302] px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white">
                  Assistant
                </p>
                <button
                  type="button"
                  onClick={() => setAssistantOpen(false)}
                  className="px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-[var(--color-muted)] transition-colors hover:bg-[#141414] hover:text-white"
                >
                  Close
                </button>
              </div>
              <div className="min-h-0 flex-1">
                <SidebarPanel
                  sessionId={sessionId}
                  onSeek={seekFromAssistant}
                  transcribedSeconds={progressTranscribedSeconds}
                  recordedSeconds={progressRecordedSeconds}
                  transcribingActive={transcribingActive}
                  transcriptionError={sourcePreparationError ?? transcriptionError}
                />
              </div>
            </aside>
          </>
        )}
      </div>
    </div>
  );
}
