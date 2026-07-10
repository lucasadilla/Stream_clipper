"use client";

import { useState } from "react";
import posthog from "posthog-js";
import { formatSeconds, formatDuration } from "@/lib/time";
import { cn } from "@/lib/utils";
import { clipDownloadUrl } from "@/lib/downloadUrls";
import { triggerFileDownload } from "@/lib/clientDownload";

export interface ClipSuggestionData {
  id: string;
  title: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  reason: string;
  confidence: number;
  suggestedLayout: string;
  status: string;
}

interface ClipSuggestionCardProps {
  clip: ClipSuggestionData;
  canRender: boolean;
  renderHint?: string;
  onSeek: (seconds: number) => void;
  onUpdate: (clip: ClipSuggestionData) => void;
}

export function ClipSuggestionCard({
  clip,
  canRender,
  renderHint,
  onSeek,
  onUpdate,
}: ClipSuggestionCardProps) {
  const [loading, setLoading] = useState(false);
  const [rendered, setRendered] = useState(clip.status === "rendered");
  const [error, setError] = useState<string | null>(null);

  const duration = clip.endTimeSeconds - clip.startTimeSeconds;
  const downloadUrl = rendered ? clipDownloadUrl(clip.id) : null;
  const safeFilename = `${clip.title.slice(0, 40) || "short"}.mp4`;

  async function handleRender() {
    setLoading(true);
    setError(null);
    posthog.capture("clip_suggestion_rendered", {
      clip_id: clip.id,
      duration_seconds: duration,
    });
    try {
      const res = await fetch(`/api/clips/${clip.id}/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ includeCaptions: false }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Render failed");

      const url = data.downloadUrl ?? clipDownloadUrl(clip.id);
      setRendered(true);
      onUpdate({ ...clip, status: "rendered" });
      await triggerFileDownload(url, safeFilename);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Render failed";
      setError(message);
      alert(message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDownload() {
    setError(null);
    try {
      await triggerFileDownload(downloadUrl!, safeFilename);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Download failed";
      setError(message);
      alert(message);
    }
  }

  async function handleReject() {
    setLoading(true);
    posthog.capture("clip_suggestion_rejected", { clip_id: clip.id });
    try {
      const res = await fetch(`/api/clips/${clip.id}/reject`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      onUpdate(data.clip);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)] p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <h4 className="font-semibold text-sm leading-snug">{clip.title}</h4>
        <span className="text-[10px] text-[var(--color-muted)] shrink-0">
          {formatSeconds(clip.startTimeSeconds)} · {formatDuration(duration)}
        </span>
      </div>

      <p className="text-xs text-[var(--color-foreground)] leading-relaxed">
        {clip.reason}
      </p>

      {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}

      {downloadUrl ? (
        <button
          type="button"
          onClick={handleDownload}
          className={cn(
            "flex items-center justify-center w-full py-2.5 rounded-lg text-sm font-semibold",
            "bg-[var(--color-success)] text-white hover:opacity-90"
          )}
        >
          Download Short
        </button>
      ) : (
        <div className="flex gap-2">
          <button
            onClick={() => onSeek(clip.startTimeSeconds)}
            className="text-xs px-3 py-2 rounded-lg border border-[var(--color-card-border)] hover:border-[var(--color-accent)]"
          >
            Preview
          </button>
          {canRender && clip.status !== "rejected" && (
            <button
              onClick={handleRender}
              disabled={loading}
              className={cn(
                "flex-1 text-sm py-2 rounded-lg font-semibold",
                "bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)]",
                "disabled:opacity-50"
              )}
            >
              {loading ? "Rendering…" : "Render & Download"}
            </button>
          )}
          {!canRender && renderHint && (
            <span className="text-[10px] text-[var(--color-warning)] self-center">
              {renderHint}
            </span>
          )}
          {clip.status === "suggested" && (
            <button
              onClick={handleReject}
              disabled={loading}
              className="text-xs px-2 py-2 text-[var(--color-muted)] hover:text-[var(--color-danger)]"
            >
              ✕
            </button>
          )}
        </div>
      )}
    </div>
  );
}
