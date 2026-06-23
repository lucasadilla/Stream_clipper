"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { YouTubePlayer, type YouTubePlayerHandle } from "@/components/YouTubePlayer";
import { StreamMetadataCard } from "@/components/StreamMetadataCard";
import { SourceVideoPanel } from "@/components/SourceVideoPanel";
import { AIChatBox } from "@/components/AIChatBox";
import { ClipSuggestionCard, type ClipSuggestionData } from "@/components/ClipSuggestionCard";
import { Timeline, type TimelineMarker } from "@/components/Timeline";
import { ChatPanel } from "@/components/ChatPanel";
import { FindClipBar } from "@/components/FindClipBar";
import { ClipPicker } from "@/components/ClipPicker";
import { clipDownloadUrl, renderJobDownloadUrl } from "@/lib/downloadUrls";
import { triggerFileDownload } from "@/lib/clientDownload";

interface SessionData {
  id: string;
  youtubeVideoId: string;
  title?: string | null;
  description?: string | null;
  channelTitle?: string | null;
  thumbnailUrl?: string | null;
  liveStatus?: string | null;
  actualStartTime?: string | null;
  scheduledStartTime?: string | null;
  concurrentViewers?: number | null;
  activeLiveChatId?: string | null;
  liveRecording?: {
    status: string;
    recordedSeconds: number;
  } | null;
  sourceMedia?: Array<{
    id: string;
    originalFilename: string;
    durationSeconds?: number | null;
    isLiveRecording?: boolean;
    width?: number | null;
    height?: number | null;
    fps?: number | null;
    sizeBytes?: string;
  }>;
  clipSuggestions?: ClipSuggestionData[];
  renderJobs?: Array<{
    id: string;
    clipSuggestionId?: string | null;
    status: string;
    progress: number;
    outputPath?: string | null;
    errorMessage?: string | null;
    createdAt: string;
  }>;
  _count?: {
    chatMessages: number;
    eventWindows: number;
    transcriptChunks: number;
    audioEvents: number;
    visualEvents: number;
  };
}

interface SessionWorkspaceProps {
  sessionId: string;
}

export function SessionWorkspace({ sessionId }: SessionWorkspaceProps) {
  const [session, setSession] = useState<SessionData | null>(null);
  const [clips, setClips] = useState<ClipSuggestionData[]>([]);
  const [markers, setMarkers] = useState<TimelineMarker[]>([]);
  const [transcripts, setTranscripts] = useState<
    Array<{
      id: string;
      startTimeSeconds: number;
      endTimeSeconds: number;
      text: string;
    }>
  >([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const playerRef = useRef<YouTubePlayerHandle>(null);

  const seekTo = useCallback((seconds: number) => {
    playerRef.current?.seekTo(seconds);
  }, []);

  async function loadSession() {
    try {
      const res = await fetch(`/api/sessions/${sessionId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load session");
      setSession(data.session);
      setClips(data.session.clipSuggestions ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  async function loadEvents() {
    const res = await fetch(`/api/sessions/${sessionId}/events`);
    const data = await res.json();
    if (!res.ok) return;

    const newMarkers: TimelineMarker[] = [];

    for (const e of data.eventWindows ?? []) {
      newMarkers.push({
        id: e.id,
        type: "chat_window",
        startTimeSeconds: e.startTimeSeconds,
        endTimeSeconds: e.endTimeSeconds,
        label: e.summary?.slice(0, 40) ?? "Chat spike",
        score: e.score,
      });
    }
    for (const t of data.transcriptChunks ?? []) {
      newMarkers.push({
        id: t.id,
        type: "transcript",
        startTimeSeconds: t.startTimeSeconds,
        endTimeSeconds: t.endTimeSeconds,
        label: t.text?.slice(0, 40) ?? "Transcript",
      });
    }
    for (const a of data.audioEvents ?? []) {
      newMarkers.push({
        id: a.id,
        type: "audio",
        startTimeSeconds: a.startTimeSeconds,
        endTimeSeconds: a.endTimeSeconds,
        label: a.summary?.slice(0, 40) ?? a.type,
        score: a.score,
      });
    }
    for (const v of data.visualEvents ?? []) {
      newMarkers.push({
        id: v.id,
        type: "visual",
        startTimeSeconds: v.startTimeSeconds,
        endTimeSeconds: v.endTimeSeconds,
        label: v.summary?.slice(0, 40) ?? v.type,
        score: v.score,
      });
    }

    setMarkers(newMarkers);
    setTranscripts(data.transcriptChunks ?? []);
  }

  useEffect(() => {
    loadSession();
    loadEvents();
  }, [sessionId]);

  const isLive =
    session?.liveStatus === "live" || session?.liveStatus === "upcoming";

  // Live pipeline: sync recording, chat, auto-suggest clips
  useEffect(() => {
    if (!session) return;

    async function tick() {
      try {
        await fetch(`/api/sessions/${sessionId}/live-tick`, { method: "POST" });
        await loadSession();
        await loadEvents();
      } catch {
        // non-fatal
      }
    }

    if (isLive || session.liveStatus === "post_live") {
      tick();
      const interval = setInterval(tick, 15000);
      return () => clearInterval(interval);
    }
  }, [sessionId, isLive, session?.liveStatus]);

  async function handleProcessVideo() {
    setProcessing(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/process-video`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Processing failed");
      await loadSession();
      await loadEvents();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Processing failed");
    } finally {
      setProcessing(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-[var(--color-muted)] animate-pulse">Loading session…</p>
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <p className="text-[var(--color-danger)]">{error ?? "Session not found"}</p>
        <Link href="/" className="text-[var(--color-accent)] text-sm">
          ← Back to home
        </Link>
      </div>
    );
  }

  const sourceMedia = session.sourceMedia?.[0];
  const recordedSeconds = Math.max(
    session.liveRecording?.recordedSeconds ?? 0,
    sourceMedia?.durationSeconds ?? 0,
    ...markers.map((m) => m.endTimeSeconds ?? 0),
    0
  );
  const duration = Math.max(recordedSeconds, currentTime, 300);

  function clipCanRender(_clip: ClipSuggestionData): boolean {
    return true;
  }

  const clipMarkers: TimelineMarker[] = clips
    .filter((c) => c.status !== "rejected")
    .map((c) => ({
      id: `clip-${c.id}`,
      type: "clip" as const,
      startTimeSeconds: c.startTimeSeconds,
      endTimeSeconds: c.endTimeSeconds,
      label: c.title,
      score: c.confidence * 10,
    }));

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-[var(--color-card-border)] px-6 py-3">
        <div className="max-w-[1600px] mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-sm text-[var(--color-muted)] hover:text-white">
              ← Home
            </Link>
            <h1 className="text-sm font-semibold truncate max-w-md">
              {session.title ?? "Stream Workspace"}
            </h1>
          </div>
          {session._count && (
            <div className="hidden sm:flex gap-4 text-[10px] text-[var(--color-muted)]">
              <span>{session._count.chatMessages} chat</span>
              <span>{session._count.eventWindows} windows</span>
              <span>{session._count.transcriptChunks} transcript</span>
              <span>{session._count.audioEvents} audio</span>
              <span>{session._count.visualEvents} visual</span>
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 max-w-[1600px] mx-auto w-full p-4 lg:p-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main area */}
          <div className="lg:col-span-2 space-y-4">
            <YouTubePlayer
              ref={playerRef}
              videoId={session.youtubeVideoId}
              onTimeUpdate={setCurrentTime}
            />

            <FindClipBar
              sessionId={sessionId}
              onClipFound={(clip) =>
                setClips((prev) => [{ ...clip, status: "rendered" }, ...prev])
              }
              onComplete={loadSession}
            />

            <SourceVideoPanel
              sessionId={sessionId}
              youtubeVideoId={session.youtubeVideoId}
              liveStatus={session.liveStatus}
              sourceMedia={sourceMedia}
              liveRecording={session.liveRecording}
              onReady={loadSession}
              onProcess={handleProcessVideo}
              processing={processing}
            />

            <Timeline
              markers={[...markers, ...clipMarkers]}
              durationSeconds={duration}
              currentTime={currentTime}
              onSeek={seekTo}
            />
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            <StreamMetadataCard session={session} />
            <AIChatBox
              sessionId={sessionId}
              onClipSuggestions={(newClips) => {
                setClips((prev) => [...newClips, ...prev]);
                loadEvents();
              }}
            />

            <ClipPicker
              sessionId={sessionId}
              currentTime={currentTime}
              recordedSeconds={recordedSeconds}
              isLive={isLive}
              markers={markers}
              transcripts={transcripts}
              onSeek={seekTo}
              onClipCreated={loadSession}
            />

            <div className="space-y-3">
              <h3 className="font-semibold text-sm">Suggested Clips</h3>
              {clips.filter((c) => c.status !== "rejected").length === 0 ? (
                <p className="text-xs text-[var(--color-muted)] text-center py-6 rounded-xl border border-[var(--color-card-border)]">
                  {isLive
                    ? "Clip suggestions appear automatically as chat heats up…"
                    : "Ask the AI for clip suggestions"}
                </p>
              ) : (
                clips
                  .filter((c) => c.status !== "rejected")
                  .map((clip) => (
                    <ClipSuggestionCard
                      key={clip.id}
                      clip={clip}
                      canRender={clipCanRender(clip)}
                      renderHint={
                        isLive && !clipCanRender(clip)
                          ? "Waiting for recording…"
                          : undefined
                      }
                      onSeek={seekTo}
                      onUpdate={(updated) =>
                        setClips((prev) =>
                          prev.map((c) => (c.id === updated.id ? updated : c))
                        )
                      }
                    />
                  ))
              )}
            </div>
          </div>
        </div>

        {/* Bottom section */}
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChatPanel
            sessionId={sessionId}
            hasLiveChat={!!session.activeLiveChatId}
            autoStart={isLive}
            onChatStarted={loadEvents}
          />

          <div className="rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)] p-4">
            <h3 className="font-semibold text-sm mb-3">Signals & Render Jobs</h3>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {markers.slice(0, 20).map((m) => (
                <button
                  key={m.id}
                  onClick={() => seekTo(m.startTimeSeconds)}
                  className="w-full text-left text-xs p-2 rounded-lg bg-[var(--color-background)] hover:border-[var(--color-accent)] border border-transparent"
                >
                  <span className="text-[var(--color-muted)] uppercase text-[10px]">
                    {m.type}
                  </span>
                  <p className="truncate">{m.label}</p>
                </button>
              ))}
              {markers.length === 0 && (
                <p className="text-xs text-[var(--color-muted)]">No signals yet</p>
              )}
            </div>

            {session.renderJobs && session.renderJobs.length > 0 && (
              <div className="mt-4 space-y-2">
                <h4 className="text-xs font-medium">Recent Renders</h4>
                {session.renderJobs.map((job) => (
                  <div
                    key={job.id}
                    className="text-xs p-2 rounded-lg bg-[var(--color-background)]"
                  >
                    <span className="capitalize">{job.status}</span>
                    {job.status === "completed" && (
                      <button
                        type="button"
                        onClick={() =>
                          triggerFileDownload(
                            job.clipSuggestionId
                              ? clipDownloadUrl(job.clipSuggestionId)
                              : renderJobDownloadUrl(job.id),
                            `short-${job.id}.mp4`
                          ).catch((err) =>
                            alert(err instanceof Error ? err.message : "Download failed")
                          )
                        }
                        className="ml-2 text-[var(--color-accent)] hover:underline"
                      >
                        Download
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
