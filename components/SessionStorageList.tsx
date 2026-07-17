"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fetchJson } from "@/lib/apiClient";
import { cn } from "@/lib/cn";
import type { StreamPlatform } from "@/lib/streamPlatform";
import { platformLabel } from "@/lib/streamPlatform";

interface SessionRow {
  sessionId: string;
  title: string | null;
  platform?: StreamPlatform;
  youtubeVideoId: string;
  liveStatus: string | null;
  createdAt: string;
  storageBytes: number;
  storageLabel: string;
}

export function SessionStorageList() {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const router = useRouter();

  async function load() {
    setLoading(true);
    try {
      const { ok, data } = await fetchJson<{
        sessions?: SessionRow[];
        signedIn?: boolean;
      }>("/api/sessions?limit=5");
      if (ok) {
        setSessions(data.sessions ?? []);
        setSignedIn(data.signedIn ?? false);
      }
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
        fullyRemoved?: boolean;
      }>(`/api/sessions/${sessionId}`, { method: "DELETE" });
      if (!ok) throw new Error(data.error ?? "Delete failed");
      await load();
      router.refresh();
      if (data.fullyRemoved === false) {
        console.warn(
          "Session removed; some files were quarantined under storage/.orphaned/"
        );
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) {
    return (
      <p className="py-4 text-center text-sm text-[var(--color-muted)] animate-pulse">
        Loading active session…
      </p>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="mx-auto w-full max-w-2xl py-6 text-center">
        <h2 className="mb-2 text-lg font-semibold">Active session</h2>
        <p className="text-sm text-[var(--color-muted)]">
          {signedIn === false ? (
            <>
              <Link href="/login" className="text-[var(--color-accent)] hover:underline">
                Sign in
              </Link>{" "}
              to see your active session.
            </>
          ) : (
            "No active session — paste a stream URL above to start. Starting a new one replaces any previous workspace."
          )}
        </p>
      </div>
    );
  }

  const active = sessions[0];

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-accent)]">
          Active session
        </h2>
        <span className="text-xs text-[var(--color-muted)]">
          {active.storageLabel} on disk
        </span>
      </div>
      <div className="overflow-hidden border border-[var(--color-card-border)] bg-[var(--color-card-border)]">
        <div className="flex items-center gap-3 bg-[#050805] px-4 py-3 text-sm">
          <div className="min-w-0 flex-1">
            <Link
              href={`/sessions/${active.sessionId}`}
              className="block truncate font-medium hover:text-[var(--color-accent)]"
            >
              {active.title ?? active.youtubeVideoId}
            </Link>
            <p className="mt-0.5 text-xs text-[var(--color-muted)]">
              {platformLabel(active.platform ?? "youtube")} · {active.storageLabel}
              {active.liveStatus === "live" && (
                <span className="ml-2 text-red-400">· LIVE</span>
              )}
            </p>
          </div>
          <button
            type="button"
            disabled={deletingId === active.sessionId}
            onClick={() => deleteSession(active.sessionId, active.title)}
            className={cn(
              "shrink-0 border border-[var(--color-card-border)] px-3 py-1.5 text-xs text-[var(--color-muted)]",
              "hover:border-red-500/50 hover:text-red-400",
              "disabled:opacity-50"
            )}
          >
            {deletingId === active.sessionId ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
      <p className="mt-2 text-center text-[10px] text-[var(--color-muted)]">
        Only one session at a time. Starting a new clip workspace replaces this one.
      </p>
    </div>
  );
}
