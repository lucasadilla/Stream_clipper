"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { EditorHeader } from "@/components/layout/EditorHeader";
import { YouTubePlayer, type YouTubePlayerHandle } from "@/components/YouTubePlayer";
import { LiveTimeline, type ClipSelection } from "@/components/LiveTimeline";
import { LIVE_TICK_MS, LIVE_SEGMENT_SECONDS } from "@/lib/timelineConstants";
import { TRANSCRIPTION_FAST_TICK_MS } from "@/lib/transcriptionConstants";
import { buildLiveTimelineSegments } from "@/lib/timelineSegments";
import { FindClipBar } from "@/components/FindClipBar";
import { TranscriptChat } from "@/components/TranscriptChat";
import { fetchJson } from "@/lib/apiClient";

interface SessionData {
  id: string;
  youtubeVideoId: string;
  title?: string | null;
  liveStatus?: string | null;
  activeLiveChatId?: string | null;
  actualStartTime?: string | null;
  videoDurationSeconds?: number;
  liveRecording?: { status: string; recordedSeconds: number } | null;
  sourceMedia?: Array<{ durationSeconds?: number | null }>;
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
  const [liveClock, setLiveClock] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [transcriptionError, setTranscriptionError] = useState<string | null>(null);
  const [transcribingActive, setTranscribingActive] = useState(false);
  const playerRef = useRef<YouTubePlayerHandle>(null);
  const sourceStarted = useRef(false);
  const transcribeInFlight = useRef(false);

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

  async function loadThumbnails() {
    try {
      const res = await fetch(`/api/sessions/${sessionId}/timeline-thumbs`);
      const data = await res.json();
      if (res.ok) setThumbnails(data.thumbnails ?? []);
    } catch {
      // optional
    }
  }

  async function loadSession() {
    try {
      const { ok, data } = await fetchJson<{ session?: SessionData; error?: string }>(
        `/api/sessions/${sessionId}`
      );
      if (!ok) throw new Error(data.error ?? "Failed to load session");
      if (!data.session) throw new Error("Session not found");
      setSession(data.session);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  async function loadEvents() {
    try {
      const { ok, data } = await fetchJson<{
        transcriptChunks?: typeof transcripts;
      }>(`/api/sessions/${sessionId}/events`);
      if (!ok) return;

      const chunks = data.transcriptChunks ?? [];
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
    loadSession();
    loadEvents();
  }, [sessionId]);

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

  useEffect(() => {
    if (!session) return;

    async function liveTick() {
      try {
        await fetch(`/api/sessions/${sessionId}/live-tick`, { method: "POST" });
        await loadSession();
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
          setTranscriptionError("OPENAI_API_KEY missing in .env");
        } else if (data.reason === "too_short") {
          setTranscriptionError("Recording too short — wait for more audio");
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
      : TRANSCRIPTION_FAST_TICK_MS * 3;
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
  const recordedSeconds = Math.max(
    session.liveRecording?.recordedSeconds ?? 0,
    sourceMedia?.durationSeconds ?? 0,
    ...transcripts.map((t) => t.endTimeSeconds),
    0
  );

  const liveElapsedSeconds =
    session.actualStartTime && isLive
      ? Math.max(0, (liveClock - new Date(session.actualStartTime).getTime()) / 1000)
      : 0;

  const streamDuration = Math.max(
    session.videoDurationSeconds ?? 0,
    playerDuration,
    liveElapsedSeconds,
    recordedSeconds,
    currentTime,
    LIVE_SEGMENT_SECONDS
  );

  const liveSegments = buildLiveTimelineSegments(
    transcripts.filter((t) => {
      const raw = t.rawJson as { cursorOnly?: boolean } | null;
      return !raw?.cursorOnly && t.text !== "[silence]" && t.text !== "[processing error]";
    }),
    recordedSeconds,
    newSegmentIds
  );

  const progressRecordedSeconds = Math.max(
    session.liveRecording?.recordedSeconds ?? 0,
    sourceMedia?.durationSeconds ?? 0,
    0
  );
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
          <div className="w-full max-w-6xl h-[min(42vh,520px)] min-h-[220px]">
            <YouTubePlayer
              ref={playerRef}
              videoId={session.youtubeVideoId}
              onTimeUpdate={setCurrentTime}
              onDurationChange={setPlayerDuration}
              fillContainer
            />
          </div>
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
            onScrub={scrubTo}
            onClipCreated={loadEvents}
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
