"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { triggerFileDownload } from "@/lib/clientDownload";

interface FindClipBarProps {
  sessionId: string;
  onComplete?: () => void;
}

export function FindClipBar({ sessionId, onComplete }: FindClipBarProps) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function findAndRender(e?: React.FormEvent) {
    e?.preventDefault();
    if (!query.trim() || loading) return;

    setError(null);
    setLoading(true);

    try {
      const res = await fetch(`/api/sessions/${sessionId}/find-clip`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: query.trim(), autoRender: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not find that moment");

      if (data.renderJob?.downloadUrl) {
        await triggerFileDownload(
          data.renderJob.downloadUrl,
          `${data.clip?.title?.slice(0, 40) || "short"}.mp4`
        );
      }
      onComplete?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={findAndRender} className="flex gap-2">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Describe a moment to find & export…"
        className="flex-1 text-xs rounded border border-[#333] bg-[#1a1a1a] px-3 py-2 focus:outline-none focus:border-[var(--color-accent)]"
      />
      <button
        type="submit"
        disabled={loading || !query.trim()}
        className={cn(
          "text-xs px-4 py-2 rounded font-medium whitespace-nowrap",
          "bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white",
          "disabled:opacity-50"
        )}
      >
        {loading ? "Finding…" : "Find Clip"}
      </button>
      {error && <p className="text-xs text-[var(--color-danger)] self-center">{error}</p>}
    </form>
  );
}
