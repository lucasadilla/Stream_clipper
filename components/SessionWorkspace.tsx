"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
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
import { FindClipBar } from "@/components/FindClipBar";
import { TranscriptChat } from "@/components/TranscriptChat";
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
  buildChatHypeMoments,
  selectHypeMomentsForTimeline,
  type ChatHypeMoment,
} from "@/lib/chatHypeTimeline";
import {
  buildAudioSpikeMarkers,
  selectAudioSpikesForTimeline,
  type AudioSpikeMarker,
  type WaveformBucket,
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
  const [transcribingActive, setTranscribingActive] = useState(false);
  const [captionsEnabled, setCaptionsEnabled] = useState(true);
  const [captionAppearance, setCaptionAppearance] = useState<CaptionAppearance>(
    readCaptionAppearancePreference
  );
  const [chatHypeMoments, setChatHypeMoments] = useState<ChatHypeMoment[]>([]);
  const [audioSpikes, setAudioSpikes] = useState<AudioSpikeMarker[]>([]);
  const [audioWaveform, setAudioWaveform] = useState<WaveformBucket[]>([]);
  const [captionEdits, setCaptionEdits] = useState<CaptionEditsMap>({});
  const captionSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playerRef = useRef<StreamPlayerHandle>(null);
  const sourceStarted = useRef(false);
  const transcribeInFlight = useRef(false);
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
    playerRef.current?.seekTo(seconds, { play: true });
    setCurrentTime(seconds);
  }, []);

  const pausePlayback = useCallback(() => {
    playerRef.current?.pause();
  }, []);

  async function loadThumbnails() {
    try {
      const res = await fetch(`/api/sessions/${sessionId}/timeline-thumbs`);
      const data = await res.json();
      if (!res.ok) return;
      const next = (data.thumbnails ?? []) as typeof thumbnails;
      setThumbnails((prev) => {
        if (
          next.length === prev.length &&
          next.every(
            (t, i) => t.startTimeSeconds === prev[i]?.startTimeSeconds
          )
        ) {
          return prev;
        }
        return next;
      });
    } catch {
      // optional
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
    try {
      await Promise.all([
        fetch(`/api/sessions/${sessionId}/chat/sync-windows`, { method: "POST" }),
        fetch(`/api/sessions/${sessionId}/audio/sync`, { method: "POST" }),
      ]).catch(() => {});

      const { ok, data } = await fetchJson<{
        transcriptChunks?: typeof transcripts;
        eventWindows?: Array<{
          id: string;
          startTimeSeconds: number;
          endTimeSeconds: number;
          type: string;
          summary?: string | null;
          score: number;
          rawData?: unknown;
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
      setChatHypeMoments(
        selectHypeMomentsForTimeline(
          buildChatHypeMoments(data.eventWindows ?? [])
        )
      );
      setAudioSpikes(
        selectAudioSpikesForTimeline(
          buildAudioSpikeMarkers(data.audioEvents ?? [])
        )
      );

      const timelineMax = coalesceTimelineSeconds([
        LIVE_SEGMENT_SECONDS,
        session?.liveRecording?.recordedSeconds,
        session?.sourceMedia?.[0]?.durationSeconds,
        ...chunks.map((t) => t.endTimeSeconds),
        ...(data.audioEvents ?? []).map((e) => e.endTimeSeconds),
      ]);
      const waveformRes = await fetchJson<{ buckets?: WaveformBucket[] }>(
        `/api/sessions/${sessionId}/audio/waveform?maxTime=${timelineMax}`
      );
      if (waveformRes.ok) {
        setAudioWaveform(waveformRes.data.buckets ?? []);
      }
    const arrived = new Set<string>();
    for (const t of chunks) {
      if (!prevTranscriptIds.current.has(t.id)) arrived.add(t.id);
    }
    prevTranscriptIds.current = new Set(chunks.map((t: { id: string }) => t.id));
    if (arrived.size > 0) {
      setNewSegmentIds(arrived);
      window.setTimeout(() => setNewSegmentIds(new Set()), 2500);
    }

    setTranscripts(chunks);
    void loadThumbnails();
    } catch {
      // non-fatal
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
    fetch(`/api/sessions/${sessionId}/download-source`, { method: "POST" }).catch(
      () => {}
    );
  }, [sessionId]);

  const isLive =
    session?.liveStatus === "live" || session?.liveStatus === "upcoming";

  const transcribedSeconds = Math.max(
    0,
    ...transcripts
      .filter((t) => {
        const raw = t.rawJson as { whisper?: boolean } | null;
        return raw?.whisper;
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
    if (
      whisper.some((c) => {
        const m = c.rawJson as { words?: unknown[] } | null;
        return Array.isArray(m?.words) && m!.words!.length > 0;
      })
    ) {
      return false;
    }
    return whisper.some(
      (c) =>
        (c.rawJson as { estimatedTiming?: boolean } | null)?.estimatedTiming !==
          false || c.endTimeSeconds - c.startTimeSeconds > 12
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
          setTranscriptionError("Waiting for local recording to download…");
        } else if (data.reason === "no_openai_key") {
          setTranscriptionError(
            "Set OPENROUTER_API_KEY or OPENAI_API_KEY in .env"
          );
        } else if (data.reason === "too_short") {
          setTranscriptionError("Recording too short — wait for more audio");
        } else if (data.reason === "provider_unavailable") {
          setTranscriptionError(
            /quota/i.test(data.error ?? "")
              ? "AI provider quota exceeded — add credits and transcription will resume automatically"
              : "AI provider unreachable — retrying automatically"
          );
        } else {
          setTranscriptionError(null);
        }

        if (!data.skipped || (data.transcribedThrough ?? 0) > 0) {
          await loadEvents();
        }
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
      router.push("/");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Delete failed");
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col bg-[var(--color-background)]">
        <EditorHeader title="Editor" />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-[var(--color-muted)] animate-pulse">Loading…</p>
        </div>
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="min-h-screen flex flex-col bg-[var(--color-background)]">
        <EditorHeader title="Editor" />
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6">
          <p className="text-[var(--color-danger)]">{error ?? "Session not found"}</p>
          <a href="/" className="text-[var(--color-accent)] text-sm hover:underline">
            ← Back to home
          </a>
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

  const streamDuration = coalesceTimelineSeconds([
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
    <div className="h-screen flex flex-col bg-[var(--color-background)] overflow-hidden">
      <EditorHeader
        title={session.title}
        storageLabel={session.storageLabel}
        isLive={isLive}
        recordedSeconds={recordedSeconds}
        deleting={deleting}
        onDelete={handleDeleteSession}
      />

      <div className="flex-1 flex flex-col min-h-0">
        {/* Video preview — larger */}
        <div className="shrink-0 px-4 pt-3 pb-2 flex justify-center">
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

        <div className="shrink-0 px-4 py-1.5 max-w-6xl w-full mx-auto">
          <FindClipBar sessionId={sessionId} onComplete={loadEvents} />
        </div>

        {/* Timeline */}
        <div className="flex-1 min-h-[120px] px-4 py-1">
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
            chatHypeMoments={chatHypeMoments}
            showChatHypeTrack={
              isLive || !!session.activeLiveChatId || chatHypeMoments.length > 0
            }
            audioWaveform={audioWaveform}
            audioSpikes={audioSpikes}
            showAudioLane={
              recordedSeconds > 0 ||
              streamDuration > LIVE_SEGMENT_SECONDS ||
              audioSpikes.length > 0 ||
              audioWaveform.length > 0
            }
          />
        </div>

        {/* Chat under timeline */}
        <div className="shrink-0 h-[min(28vh,240px)] min-h-[160px]">
          <TranscriptChat
            sessionId={sessionId}
            onSeek={seekFromAssistant}
            transcribedSeconds={progressTranscribedSeconds}
            recordedSeconds={progressRecordedSeconds}
            transcribingActive={transcribingActive}
            transcriptionError={transcriptionError}
          />
        </div>
      </div>
    </div>
  );
}
