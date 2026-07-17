"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import { EditorHeader } from "@/components/layout/EditorHeader";
import { VideoPreview } from "@/components/VideoPreview";
import type { StreamPlayerHandle } from "@/types/streamPlayer";
import type { StreamPlatform, StreamEmbedInfo } from "@/lib/streamPlatform";
import { shouldPreferLocalVideoPreview } from "@/lib/streamPlatform";
import { LiveTimeline, type ClipSelection } from "@/components/LiveTimeline";
import { ChatPanel } from "@/components/ChatPanel";
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
import { EditorPreparingScreen } from "@/components/EditorPreparingScreen";
import {
  beginPaneResize,
  useEditorLayoutPrefs,
} from "@/lib/editorLayoutPrefs";
import {
  computeEditorReadiness,
  readEditorPreparedFlag,
  writeEditorPreparedFlag,
} from "@/lib/editorReadiness";

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

  const currentTimeRef = useRef(0);
  const timeUpdateRaf = useRef<number | null>(null);
  const lastUiTimeFlush = useRef(0);
  const scrubLockUntil = useRef(0);
  const scrubTargetRef = useRef<number | null>(null);
  /** While false, playhead is user-owned (paused/scrubbed) — ignore embed clock. */
  const followPlayerClockRef = useRef(false);

  const handlePlayerTimeUpdate = useCallback((time: number) => {
    if (!followPlayerClockRef.current) return;

    const now = performance.now();
    // Right after play-from-playhead, ignore stale embed ticks until seek settles.
    if (now < scrubLockUntil.current) {
      const target = scrubTargetRef.current;
      if (target != null && Math.abs(time - target) > 0.5) {
        return;
      }
      scrubLockUntil.current = 0;
      scrubTargetRef.current = null;
    }

    currentTimeRef.current = time;
    if (now - lastUiTimeFlush.current < 120) {
      if (timeUpdateRaf.current == null) {
        timeUpdateRaf.current = requestAnimationFrame(() => {
          timeUpdateRaf.current = null;
          lastUiTimeFlush.current = performance.now();
          setCurrentTime(currentTimeRef.current);
        });
      }
      return;
    }
    lastUiTimeFlush.current = now;
    setCurrentTime(time);
  }, []);

  const [liveClock, setLiveClock] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [editorReady, setEditorReady] = useState(false);
  const [prepareClock, setPrepareClock] = useState(() => Date.now());
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
    chatWidth,
    setChatWidth,
    chatVisible,
    toggleChatVisible,
  } = useEditorLayoutPrefs();
  const captionSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playerRef = useRef<StreamPlayerHandle>(null);
  const sourceStarted = useRef(false);
  const transcribeInFlight = useRef(false);
  const eventsInFlight = useRef(false);
  const audioSyncInFlight = useRef(false);
  const thumbnailsInFlight = useRef<Promise<void> | null>(null);
  const eventsPromiseRef = useRef<Promise<void> | null>(null);
  const transcriptSignature = useRef("");
  const captionRebuildAttempted = useRef(false);
  const sessionLoadedOnce = useRef(false);
  const prepareStartedAt = useRef<number | null>(null);
  const previousSessionIdRef = useRef(sessionId);
  const previouslyPreparedRef = useRef(readEditorPreparedFlag(sessionId));

  const pinPlayhead = useCallback((seconds: number) => {
    const t = sanitizeDurationSeconds(seconds);
    followPlayerClockRef.current = false;
    scrubTargetRef.current = t;
    scrubLockUntil.current = performance.now() + 800;
    currentTimeRef.current = t;
    setCurrentTime(t);
    return t;
  }, []);

  const seekTo = useCallback(
    (seconds: number) => {
      const t = sanitizeDurationSeconds(seconds);
      scrubTargetRef.current = t;
      scrubLockUntil.current = performance.now() + 800;
      currentTimeRef.current = t;
      setCurrentTime(t);
      // Follow the player only after we intentionally start playback.
      followPlayerClockRef.current = true;
      playerRef.current?.seekTo(t, { play: true });
    },
    []
  );

  const seekFromAssistant = useCallback(
    (seconds: number) => {
      seekTo(seconds);
      setClipSelection({
        start: seconds,
        end: seconds + LIVE_SEGMENT_SECONDS,
      });
    },
    [seekTo]
  );

  const scrubTo = useCallback(
    (seconds: number) => {
      const t = pinPlayhead(seconds);
      playerRef.current?.seekTo(t, { play: false });
    },
    [pinPlayhead]
  );

  const pausePlayback = useCallback(() => {
    followPlayerClockRef.current = false;
    playerRef.current?.pause();
  }, []);

  async function loadThumbnails() {
    if (thumbnailsInFlight.current) return thumbnailsInFlight.current;
    const request = (async () => {
      try {
        const res = await fetch(`/api/sessions/${sessionId}/timeline-thumbs`);
        const data = await res.json();
        if (!res.ok) return;
        const next = (data.thumbnails ?? []) as typeof thumbnails;
        setThumbnails((prev) => {
          // Never wipe a populated filmstrip with an empty transient response.
          if (next.length === 0 && prev.length > 0) return prev;
          if (timelineThumbsEqual(prev, next)) return prev;
          return next;
        });
      } catch {
        // optional
      }
    })().finally(() => {
      thumbnailsInFlight.current = null;
    });
    thumbnailsInFlight.current = request;
    return request;
  }

  async function loadSession(options?: { holdLoading?: boolean }) {
    const isInitialLoad = !sessionLoadedOnce.current;
    try {
      const { ok, data } = await fetchJson<{ session?: SessionData; error?: string }>(
        `/api/sessions/${sessionId}`
      );
      if (!ok) throw new Error(data.error ?? "Failed to load session");
      if (!data.session) throw new Error("Session not found");
      setSession(data.session);
      sessionLoadedOnce.current = true;
      if (prepareStartedAt.current == null) {
        prepareStartedAt.current = Date.now();
      }
    } catch (err) {
      // Background refresh failures (dev recompile blips) must not kill the editor.
      if (isInitialLoad) {
        setError(err instanceof Error ? err.message : "Failed to load");
      }
    } finally {
      if (!options?.holdLoading) setLoading(false);
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
    if (eventsPromiseRef.current) return eventsPromiseRef.current;
    const request = (async () => {
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

        // Never blank a loaded transcript with a transient empty poll
        // (e.g. mid-rebuild wipe). Keep previous until nonempty data returns.
        if (chunks.length === 0 && prevTranscriptIds.current.size > 0) {
          return;
        }

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
      }
    })().finally(() => {
      eventsPromiseRef.current = null;
      eventsInFlight.current = false;
    });
    eventsPromiseRef.current = request;
    eventsInFlight.current = true;
    return request;
  }

  useEffect(() => {
    setCaptionsEnabled(readCaptionsEnabledPreference());
    setCaptionAppearance(readCaptionAppearancePreference());
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (previousSessionIdRef.current !== sessionId) {
      previousSessionIdRef.current = sessionId;
      previouslyPreparedRef.current = readEditorPreparedFlag(sessionId);
      setEditorReady(false);
      prepareStartedAt.current = null;
      sessionLoadedOnce.current = false;
      sourceStarted.current = false;
      captionRebuildAttempted.current = false;
      transcriptSignature.current = "";
      prevTranscriptIds.current = new Set();
      thumbnailsInFlight.current = null;
      eventsPromiseRef.current = null;
      setPrepareClock(Date.now());
      setError(null);
      setTranscripts([]);
      setThumbnails([]);
      setSession(null);
    }

    setLoading(true);
    void (async () => {
      try {
        await Promise.all([
          loadSession({ holdLoading: true }),
          loadEvents(),
          loadCaptionEdits(),
          loadThumbnails(),
        ]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    if (!session) return;
    // Poll filmstrip faster while waiting to open the editor.
    const ms = editorReady ? THUMB_POLL_MS : 1000;
    const id = setInterval(() => void loadThumbnails(), ms);
    return () => clearInterval(id);
  }, [sessionId, session?.id, editorReady]);

  useEffect(() => {
    if (!session || editorReady) return;
    const id = setInterval(() => {
      void loadEvents();
      void loadSession();
      setPrepareClock(Date.now());
    }, 1500);
    return () => clearInterval(id);
  }, [sessionId, session?.id, editorReady]);

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
          !raw?.cursorOnly &&
          t.text !== "[silence]" &&
          t.text !== "[processing error]"
        );
      })
      .map((t) => t.endTimeSeconds)
  );

  /** Whisper-backed coverage — used for "behind" polling, not the prepare gate. */
  const whisperTranscribedSeconds = Math.max(
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
    recordedSecondsForTx > 5 &&
    whisperTranscribedSeconds < recordedSecondsForTx - 15;

  function transcriptsNeedTimingRebuild(
    chunks: typeof transcripts
  ): boolean {
    const whisper = chunks.filter((c) => {
      const m = c.rawJson as { whisper?: boolean } | null;
      return m?.whisper;
    });
    if (whisper.length === 0) return false;
    // Segment-timed Whisper rows without word arrays are valid for captions.
    // Only rebuild rows that were explicitly marked as estimated timing.
    return whisper.some((c) => {
      const meta = c.rawJson as {
        words?: unknown[];
        estimatedTiming?: boolean;
        cursorOnly?: boolean;
      } | null;
      if (meta?.cursorOnly || c.text === "[silence]") return false;
      return meta?.estimatedTiming === true;
    });
  }

  useEffect(() => {
    if (captionRebuildAttempted.current || transcripts.length === 0) return;
    if (!transcriptsNeedTimingRebuild(transcripts)) return;
    captionRebuildAttempted.current = true;
    // Persist so a refresh does not wipe + rebuild again in a loop.
    try {
      sessionStorage.setItem(`clipper:captionRebuild:${sessionId}`, "1");
    } catch {
      // ignore
    }
    fetch(`/api/sessions/${sessionId}/transcribe?rebuild=1`, { method: "POST" })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as {
          success?: boolean;
          skipped?: boolean;
        };
        if (data.success === false || data.skipped) {
          // Allow a later retry if wipe was blocked.
          captionRebuildAttempted.current = false;
          return;
        }
        await loadEvents();
      })
      .catch(() => {
        captionRebuildAttempted.current = false;
      });
  }, [sessionId, transcripts]);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(`clipper:captionRebuild:${sessionId}`) === "1") {
        captionRebuildAttempted.current = true;
      }
    } catch {
      // ignore
    }
  }, [sessionId]);

  useEffect(() => {
    if (!session) return;

    async function liveTick() {
      try {
        await fetch(`/api/sessions/${sessionId}/live-tick`, { method: "POST" });
        await loadSession();
        await loadEvents();
        // Thumbnails: dedicated 2s poll owns filmstrip updates (avoids duplicate work).
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

    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    async function runTranscribe() {
      if (transcribeInFlight.current || cancelled) return;
      transcribeInFlight.current = true;
      setTranscribingActive(true);
      const abort = new AbortController();
      // Never let a hung /transcribe (e.g. old blocking companion download)
      // freeze the in-flight flag and stop all future polls.
      const hangWatchdog = setTimeout(() => abort.abort(), 90_000);
      try {
        const { ok, data } = await fetchJson<{
          error?: string;
          reason?: string;
          skipped?: boolean;
          transcribedThrough?: number;
        }>(`/api/sessions/${sessionId}/transcribe`, {
          method: "POST",
          signal: abort.signal,
        });

        if (cancelled) return;

        if (!ok) {
          setTranscriptionError(data.error ?? "Transcription failed");
        } else if (data.reason === "no_file") {
          setTranscriptionError("Waiting for local recording to download...");
        } else if (data.reason === "no_audio") {
          setTranscriptionError(
            "Waiting for audio track — video-only capture detected, fetching audio…"
          );
        } else if (data.reason === "no_openai_key") {
          setTranscriptionError(
            "Set OPENROUTER_API_KEY or OPENAI_API_KEY in .env"
          );
        } else if (data.reason === "too_short") {
          setTranscriptionError("Waiting for enough audio to transcribe...");
        } else if (data.reason === "audio_not_ready") {
          setTranscriptionError(
            "Buffering capture — transcription will resume shortly"
          );
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
        if (cancelled) return;
        if (err instanceof DOMException && err.name === "AbortError") {
          setTranscriptionError(
            "Transcription timed out — retrying automatically"
          );
        } else {
          setTranscriptionError(
            err instanceof Error ? err.message : "Transcription request failed"
          );
        }
      } finally {
        clearTimeout(hangWatchdog);
        transcribeInFlight.current = false;
        if (!cancelled) setTranscribingActive(false);
      }
    }

    void runTranscribe();
    const ms = transcriptionBehind
      ? TRANSCRIPTION_FAST_TICK_MS
      : TRANSCRIPTION_SLOW_TICK_MS;
    intervalId = setInterval(() => void runTranscribe(), ms);
    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
    // Intentionally omit transcribedSeconds — changing it restarted this effect
    // and could strand an in-flight request. Behind-ness only adjusts interval.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, session?.id, transcriptionBehind]);

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

  // Hooks must run before any early return (loading / error).
  const segmentTranscripts = useMemo(
    () =>
      transcripts.filter((t) => {
        const raw = t.rawJson as { cursorOnly?: boolean } | null;
        return (
          !raw?.cursorOnly &&
          t.text !== "[silence]" &&
          t.text !== "[processing error]"
        );
      }),
    [transcripts]
  );
  const recordedSecondsForSegments = coalesceTimelineSeconds([
    session?.liveRecording?.recordedSeconds,
    session?.sourceMedia?.[0]?.durationSeconds,
    ...transcripts.map((t) => t.endTimeSeconds),
  ]);
  const recordedBlockKey = Math.floor(
    recordedSecondsForSegments / LIVE_SEGMENT_SECONDS
  );
  const liveSegments = useMemo(
    () =>
      buildLiveTimelineSegments(
        segmentTranscripts,
        recordedSecondsForSegments,
        newSegmentIds
      ),
    // newSegmentIds identity changes often; key on size + recorded blocks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [segmentTranscripts, recordedBlockKey, newSegmentIds.size]
  );

  const editorReadiness = useMemo(
    () =>
      computeEditorReadiness({
        recordedSeconds: Math.max(
          recordedSecondsForTx,
          recordedSecondsForSegments
        ),
        transcribedSeconds,
        thumbnails,
        prepareElapsedMs: prepareStartedAt.current
          ? Math.max(0, prepareClock - prepareStartedAt.current)
          : 0,
        hasSourceError: Boolean(sourcePreparationError),
        previouslyPrepared: previouslyPreparedRef.current,
        transcriptionHint: transcriptionError,
      }),
    [
      recordedSecondsForTx,
      recordedSecondsForSegments,
      transcribedSeconds,
      thumbnails,
      prepareClock,
      sourcePreparationError,
      transcriptionError,
    ]
  );

  useEffect(() => {
    if (!session || editorReady) return;
    if (!editorReadiness.ready) return;
    setEditorReady(true);
    previouslyPreparedRef.current = true;
    writeEditorPreparedFlag(sessionId, true);
  }, [editorReady, editorReadiness.ready, session, sessionId]);

  if (loading) {
    return (
      <EditorPreparingScreen
        readiness={{
          ...computeEditorReadiness({
            recordedSeconds: 0,
            transcribedSeconds: 0,
            thumbnails: [],
            prepareElapsedMs: 0,
          }),
          statusMessage: "Loading session",
          detailMessage: "Fetching stream details…",
        }}
      />
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

  if (!editorReady) {
    return (
      <EditorPreparingScreen
        title={session.title ?? "Editor"}
        readiness={editorReadiness}
      />
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
  const recordedSeconds = recordedSecondsForSegments;

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
        chatVisible={chatVisible}
        onToggleChat={toggleChatVisible}
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

          {/* Program monitor + optional chat (right of video) */}
          <div
            className="flex shrink-0 border-b border-[var(--color-card-border)]"
            style={{ height: monitorHeight }}
          >
            <div className="min-h-0 min-w-0 flex-1">
              <VideoPreview
                platform={platform}
                sourceId={session.youtubeVideoId}
                embed={streamEmbed}
                playbackVideoUrl={playbackVideoUrl}
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

            {chatVisible && (
              <>
                <div
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Resize chat"
                  title="Drag to resize chat"
                  className="group relative z-10 hidden w-1.5 shrink-0 cursor-col-resize bg-[#0a100a] hover:bg-[var(--color-accent)]/40 md:block"
                  onPointerDown={(event) =>
                    beginPaneResize({
                      axis: "col",
                      startSize: chatWidth,
                      onResize: setChatWidth,
                      event,
                      invert: true,
                    })
                  }
                >
                  <span className="pointer-events-none absolute inset-y-0 -left-1 -right-1" />
                </div>

                <div
                  className="hidden min-h-0 shrink-0 border-l border-[var(--color-card-border)] md:block"
                  style={{ width: chatWidth }}
                >
                  <ChatPanel
                    sessionId={sessionId}
                    hasLiveChat={Boolean(session.activeLiveChatId)}
                    currentTime={currentTime}
                    onSeek={seekTo}
                    autoStart={Boolean(isLive && session.activeLiveChatId)}
                    onChatStarted={() => {
                      void loadEvents();
                    }}
                  />
                </div>
              </>
            )}
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

          {/* Timeline — full width */}
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
