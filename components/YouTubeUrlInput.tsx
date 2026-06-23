"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

export function YouTubeUrlInput() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ youtubeUrl: url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create session");
      router.push(`/sessions/${data.session.id}`);
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
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.youtube.com/watch?v=..."
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
