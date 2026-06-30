"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { fetchJson } from "@/lib/apiClient";
import { normalizeUserYoutubeUrl } from "@/lib/youtube";

export function YouTubeUrlInput() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const normalized = normalizeUserYoutubeUrl(url);
    if (!normalized.trim()) {
      setError("Please enter a YouTube URL");
      return;
    }

    setLoading(true);

    try {
      const { ok, data } = await fetchJson<{ session?: { id: string }; error?: string }>(
        "/api/sessions",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ youtubeUrl: normalized }),
        }
      );
      if (!ok) throw new Error(data.error ?? "Failed to create session");
      if (!data.session?.id) throw new Error("Failed to create session");
      // Full navigation avoids dev-mode RSC flight parse errors on client routing
      window.location.assign(`/sessions/${data.session.id}`);
      return;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-2xl">
      <div className="flex flex-col sm:flex-row gap-3">
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="youtube.com/watch?v=... or paste live link"
          required
          className={cn(
            "flex-1 rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)]",
            "px-4 py-3 text-sm placeholder:text-[var(--color-muted)]",
            "focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
          )}
        />
        <button
          type="submit"
          disabled={loading || !url.trim()}
          className={cn(
            "rounded-xl px-6 py-3 text-sm font-semibold whitespace-nowrap",
            "bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)]",
            "disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          )}
        >
          {loading ? "Analyzing…" : "Analyze YouTube Stream"}
        </button>
      </div>
      {error && (
        <p className="mt-3 text-sm text-[var(--color-danger)]">{error}</p>
      )}
    </form>
  );
}
