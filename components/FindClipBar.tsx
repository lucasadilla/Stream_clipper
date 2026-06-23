"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { RenderJobStatus } from "@/components/RenderJobStatus";
import type { ClipSuggestionData } from "@/components/ClipSuggestionCard";
import { triggerFileDownload } from "@/lib/clientDownload";

interface FindClipBarProps {
  sessionId: string;
  onClipFound?: (clip: ClipSuggestionData) => void;
  onComplete?: () => void;
}

export function FindClipBar({
  sessionId,
  onClipFound,
  onComplete,
}: FindClipBarProps) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastAnswer, setLastAnswer] = useState<string | null>(null);
  const [renderJobId, setRenderJobId] = useState<string | null>(null);
  const [renderDownloadUrl, setRenderDownloadUrl] = useState<string | null>(null);

  async function findAndRender(e?: React.FormEvent) {
    e?.preventDefault();
    if (!query.trim() || loading) return;

    setError(null);
    setLoading(true);
    setLastAnswer(null);
    setRenderJobId(null);
    setRenderDownloadUrl(null);

    try {
      const res = await fetch(`/api/sessions/${sessionId}/find-clip`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: query.trim(),
          autoRender: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not find that moment");

      setLastAnswer(data.answer);
      if (data.clip) onClipFound?.(data.clip);
      if (data.renderJob?.downloadUrl) {
        try {
          await triggerFileDownload(
            data.renderJob.downloadUrl,
            `${data.clip?.title?.slice(0, 40) || "short"}.mp4`
          );
          onComplete?.();
        } catch (downloadErr) {
          setError(
            downloadErr instanceof Error ? downloadErr.message : "Download failed"
          );
          if (data.renderJob?.jobId) setRenderJobId(data.renderJob.jobId);
        }
      } else if (data.renderJob?.jobId) {
        setRenderJobId(data.renderJob.jobId);
        setRenderDownloadUrl(data.renderJob.downloadUrl ?? null);
      } else {
        onComplete?.();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-[var(--color-accent)]/40 bg-[var(--color-card)] p-4 space-y-3">
      <div>
        <h3 className="font-semibold text-sm">Find a clip</h3>
        <p className="text-[10px] text-[var(--color-muted)] mt-1">
          Describe what happened — we&apos;ll find the moment and render your Short
          automatically.
        </p>
      </div>

      <form onSubmit={findAndRender} className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="What happened in the stream?"
          className="flex-1 text-sm rounded-lg border border-[var(--color-card-border)] bg-[var(--color-background)] px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
        />
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className={cn(
            "text-sm px-5 py-2.5 rounded-lg font-semibold whitespace-nowrap",
            "bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)]",
            "disabled:opacity-50"
          )}
        >
          {loading ? "Finding & rendering…" : "Find Clip"}
        </button>
      </form>

      {lastAnswer && (
        <p className="text-xs text-[var(--color-success)]">{lastAnswer}</p>
      )}
      {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}

      {renderJobId && (
        <RenderJobStatus
          jobId={renderJobId}
          downloadUrl={renderDownloadUrl ?? undefined}
          onComplete={() => onComplete?.()}
        />
      )}
    </div>
  );
}
