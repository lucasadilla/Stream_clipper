"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fetchJson } from "@/lib/apiClient";
import { cn } from "@/lib/utils";

interface SessionRow {
  sessionId: string;
  title: string | null;
  youtubeVideoId: string;
  liveStatus: string | null;
  createdAt: string;
  storageBytes: number;
  storageLabel: string;
}

export function SessionStorageList() {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const router = useRouter();

  async function load() {
    setLoading(true);
    try {
      const { ok, data } = await fetchJson<{ sessions?: SessionRow[] }>(
        "/api/sessions?limit=20"
      );
      if (ok) setSessions(data.sessions ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function deleteSession(sessionId: string, title: string | null) {
    const label = title ?? "this session";
    if (
      !window.confirm(
        `Delete "${label}" and free its disk space?\n\nThis removes the session, recordings, and rendered clips.`
      )
    ) {
      return;
    }

    setDeletingId(sessionId);
    try {
      const { ok, data } = await fetchJson<{
        error?: string;
        storageLabel?: string;
      }>(`/api/sessions/${sessionId}`, { method: "DELETE" });
      if (!ok) throw new Error(data.error ?? "Delete failed");
      await load();
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) {
    return (
      <p className="text-sm text-[var(--color-muted)] text-center py-4 animate-pulse">
        Loading saved sessions…
      </p>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="w-full max-w-2xl mx-auto text-center py-6">
        <h2 className="text-lg font-semibold mb-2">Recent sessions</h2>
        <p className="text-sm text-[var(--color-muted)]">
          No sessions yet — analyze a stream above to get started.
        </p>
      </div>
    );
  }

  const totalBytes = sessions.reduce((n, s) => n + s.storageBytes, 0);
  const totalLabel = sessions[0]
    ? formatTotalBytes(totalBytes)
    : "0 B";

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-[var(--color-muted)]">
          Recent sessions
        </h2>
        <span className="text-xs text-[var(--color-muted)]">
          {totalLabel} on disk
        </span>
      </div>
      <ul className="rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)] divide-y divide-[var(--color-card-border)] overflow-hidden">
        {sessions.map((s) => (
          <li
            key={s.sessionId}
            className="flex items-center gap-3 px-4 py-3 text-sm"
          >
            <div className="flex-1 min-w-0">
              <Link
                href={`/sessions/${s.sessionId}`}
                className="font-medium truncate block hover:text-[var(--color-accent)]"
              >
                {s.title ?? s.youtubeVideoId}
              </Link>
              <p className="text-xs text-[var(--color-muted)] mt-0.5">
                {s.storageLabel}
                {s.liveStatus === "live" && (
                  <span className="text-red-400 ml-2">· LIVE</span>
                )}
              </p>
            </div>
            <button
              type="button"
              disabled={deletingId === s.sessionId}
              onClick={() => deleteSession(s.sessionId, s.title)}
              className={cn(
                "text-xs px-3 py-1.5 rounded-lg border shrink-0",
                "border-[var(--color-card-border)] text-[var(--color-muted)]",
                "hover:border-red-500/50 hover:text-red-400",
                "disabled:opacity-50"
              )}
            >
              {deletingId === s.sessionId ? "Deleting…" : "Delete"}
            </button>
          </li>
        ))}
      </ul>
      <p className="text-[10px] text-[var(--color-muted)] mt-2 text-center">
        Deletes local recordings and clips from ./storage — frees disk space on your PC.
      </p>
    </div>
  );
}

function formatTotalBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}
