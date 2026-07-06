"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { fetchJson } from "@/lib/apiClient";
import { normalizeUserStreamUrl, parseStreamUrl } from "@/lib/streamPlatform";

export function StreamUrlInput() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const normalized = normalizeUserStreamUrl(url);
    if (!normalized.trim()) {
      setError("Please enter a stream URL");
      return;
    }

    if (!parseStreamUrl(normalized)) {
      setError(
        "Use a YouTube, Twitch (twitch.tv/channel or /videos/…), or Kick (kick.com/channel) link"
      );
      return;
    }

    setLoading(true);

    try {
      const { ok, data } = await fetchJson<{ session?: { id: string }; error?: string }>(
        "/api/sessions",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ streamUrl: normalized }),
        }
      );
      if (!ok) throw new Error(data.error ?? "Failed to create session");
      if (!data.session?.id) throw new Error("Failed to create session");
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
          placeholder="YouTube, Twitch, or Kick live / VOD link"
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
          {loading ? "Analyzing…" : "Analyze stream"}
        </button>
      </div>
      {error && (
        <p className="mt-3 text-sm text-[var(--color-danger)]">{error}</p>
      )}
    </form>
  );
}

/** @deprecated Use StreamUrlInput */
export const YouTubeUrlInput = StreamUrlInput;
