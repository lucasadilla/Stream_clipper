"use client";

import { useState, useEffect, useRef } from "react";
import { formatSeconds } from "@/lib/time";
import { cn } from "@/lib/utils";

interface SourceMedia {
  id: string;
  originalFilename: string;
  durationSeconds?: number | null;
  isLiveRecording?: boolean;
  width?: number | null;
  height?: number | null;
  fps?: number | null;
  sizeBytes?: string;
}

interface LiveRecording {
  status: string;
  recordedSeconds: number;
}

interface SourceVideoPanelProps {
  sessionId: string;
  youtubeVideoId: string;
  liveStatus?: string | null;
  sourceMedia?: SourceMedia | null;
  liveRecording?: LiveRecording | null;
  onReady?: () => void;
  onProcess?: () => void;
  processing?: boolean;
}

export function SourceVideoPanel({
  sessionId,
  youtubeVideoId,
  liveStatus,
  sourceMedia,
  liveRecording,
  onReady,
  onProcess,
  processing,
}: SourceVideoPanelProps) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  const isLive =
    liveStatus === "live" || liveStatus === "upcoming";

  const isRecording =
    liveRecording?.status === "recording" || sourceMedia?.isLiveRecording;

  const recordedSeconds =
    liveRecording?.recordedSeconds ?? sourceMedia?.durationSeconds ?? 0;

  async function startCapture() {
    setError(null);
    setStarting(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/download-source`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to start capture");
      onReady?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Capture failed");
      started.current = false;
    } finally {
      setStarting(false);
    }
  }

  // Auto-start recording (live) or download (VOD) when workspace opens
  useEffect(() => {
    if (starting || started.current) return;
    if (isLive && liveRecording?.status === "recording") return;
    if (!isLive && sourceMedia && (sourceMedia.durationSeconds ?? 0) > 0) return;

    started.current = true;
    startCapture();
  }, [sessionId, isLive, sourceMedia?.durationSeconds, liveRecording?.status]);

  return (
    <div className="rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)] p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-sm">
          {isLive ? "Live Capture" : "Source Video"}
        </h3>
        {isRecording && (
          <span className="text-[10px] text-[var(--color-success)] flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            REC {formatSeconds(recordedSeconds)}
          </span>
        )}
      </div>

      <p className="text-xs text-[var(--color-muted)] mb-4">
        {isLive
          ? "Recording the stream in the background so you can clip and render while it's live."
          : "Video captured from your YouTube URL — ready to process and render."}
      </p>

      {starting && !recordedSeconds && (
        <div className="border border-[var(--color-card-border)] rounded-lg p-6 text-center mb-3">
          <p className="text-sm text-[var(--color-muted)] animate-pulse">
            {isLive ? "Starting live capture…" : "Downloading from YouTube…"}
          </p>
        </div>
      )}

      {(sourceMedia || recordedSeconds > 0) && (
        <div className="mb-4 p-3 rounded-lg bg-[var(--color-background)] text-xs space-y-1">
          <p className="font-medium">
            {isRecording ? "Recording" : "Captured"} · {youtubeVideoId}
          </p>
          {recordedSeconds > 0 && (
            <p className="text-[var(--color-muted)]">
              {formatSeconds(recordedSeconds)} captured
              {sourceMedia?.width &&
                sourceMedia?.height &&
                ` · ${sourceMedia.width}×${sourceMedia.height}`}
            </p>
          )}
        </div>
      )}

      <div className="flex gap-2">
        {recordedSeconds > 30 && (
          <button
            onClick={onProcess}
            disabled={processing}
            className={cn(
              "text-xs px-3 py-1.5 rounded-lg font-medium",
              "bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)]",
              "disabled:opacity-50"
            )}
          >
            {processing ? "Processing…" : "Analyze Captured Video"}
          </button>
        )}
        {!isRecording && (
          <button
            onClick={() => {
              started.current = false;
              startCapture();
            }}
            disabled={starting}
            className="text-xs px-3 py-1.5 rounded-lg border border-[var(--color-card-border)] hover:bg-[var(--color-background)] disabled:opacity-50"
          >
            {starting ? "…" : isLive ? "Restart capture" : "Re-download"}
          </button>
        )}
      </div>

      {error && (
        <p className="mt-2 text-xs text-[var(--color-danger)]">{error}</p>
      )}
    </div>
  );
}
