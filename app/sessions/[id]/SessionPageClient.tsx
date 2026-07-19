"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { fetchJson } from "@/lib/apiClient";
import { normalizeSessionMode, type SessionMode } from "@/lib/sessionMode";

const SessionWorkspace = dynamic(
  () =>
    import("@/components/SessionWorkspace").then((mod) => mod.SessionWorkspace),
  {
    ssr: false,
    loading: () => (
      <div className="editor-shell min-h-screen flex flex-col bg-[var(--color-background)]">
        <div className="h-12 border-b border-[var(--color-card-border)]" />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-[var(--color-muted)] animate-pulse">Loading editor...</p>
        </div>
      </div>
    ),
  }
);

const AgentWorkspace = dynamic(
  () =>
    import("@/components/AgentWorkspace").then((mod) => mod.AgentWorkspace),
  {
    ssr: false,
    loading: () => (
      <div className="editor-shell min-h-screen flex flex-col bg-[var(--color-background)]">
        <div className="h-12 border-b border-[var(--color-card-border)]" />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-[var(--color-muted)] animate-pulse">Loading agent...</p>
        </div>
      </div>
    ),
  }
);

export function SessionPageClient({ sessionId }: { sessionId: string }) {
  const [mode, setMode] = useState<SessionMode | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchJson<{ session?: { mode?: string }; error?: string }>(
      `/api/sessions/${sessionId}`
    )
      .then(({ ok, data }) => {
        if (cancelled) return;
        if (!ok || !data.session) {
          setError(data.error ?? "Session not found");
          return;
        }
        setMode(normalizeSessionMode(data.session.mode));
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load session");
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  if (error) {
    return (
      <div className="editor-shell min-h-screen flex flex-col bg-[var(--color-background)]">
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6">
          <p className="text-[var(--color-danger)]">{error}</p>
          <Link href="/" className="text-sm text-[var(--color-accent)] hover:underline">
            Back to home
          </Link>
        </div>
      </div>
    );
  }

  if (!mode) {
    return (
      <div className="editor-shell min-h-screen flex flex-col bg-[var(--color-background)]">
        <div className="h-12 border-b border-[var(--color-card-border)]" />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-[var(--color-muted)] animate-pulse">Loading session…</p>
        </div>
      </div>
    );
  }

  if (mode === "agent") {
    return <AgentWorkspace sessionId={sessionId} />;
  }

  return <SessionWorkspace sessionId={sessionId} />;
}
