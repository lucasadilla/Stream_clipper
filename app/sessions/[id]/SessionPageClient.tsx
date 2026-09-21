"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { fetchJson } from "@/lib/apiClient";
import { normalizeSessionMode, type SessionMode } from "@/lib/sessionMode";
import type { SessionData } from "@/components/SessionWorkspace";
import {
  readSessionBootstrap,
  writeSessionBootstrap,
} from "@/lib/sessionBootstrap";
import { EditorWorkspaceSkeleton } from "@/components/EditorWorkspaceSkeleton";

const SessionWorkspace = dynamic(
  () =>
    import("@/components/SessionWorkspace").then((mod) => mod.SessionWorkspace),
  {
    ssr: false,
    loading: () => <EditorWorkspaceSkeleton mode="timeline" />,
  }
);

const AgentWorkspace = dynamic(
  () =>
    import("@/components/AgentWorkspace").then((mod) => mod.AgentWorkspace),
  {
    ssr: false,
    loading: () => <EditorWorkspaceSkeleton mode="agent" />,
  }
);

export function SessionPageClient({ sessionId }: { sessionId: string }) {
  // Keep the server and first browser render identical. Session storage is
  // restored immediately after hydration instead of inside state initializers.
  const [mode, setMode] = useState<SessionMode | null>(null);
  const [session, setSession] = useState<
    (SessionData & { mode?: string }) | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [modeSwitching, setModeSwitching] = useState(false);
  const [modeError, setModeError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const bootstrap = readSessionBootstrap(sessionId);
    if (bootstrap) {
      setMode(bootstrap.mode);
      setSession(bootstrap as SessionData);
    }

    void fetchJson<{
      session?: SessionData & { mode?: string };
      error?: string;
    }>(
      `/api/sessions/${sessionId}`
    )
      .then(({ ok, data }) => {
        if (cancelled) return;
        if (!ok || !data.session) {
          setError(data.error ?? "Session not found");
          return;
        }
        setSession(data.session);
        const nextMode = normalizeSessionMode(data.session.mode);
        setMode(nextMode);
        writeSessionBootstrap({
          id: data.session.id,
          mode: nextMode,
          platform: data.session.platform,
          youtubeVideoId: data.session.youtubeVideoId,
          youtubeUrl: data.session.youtubeUrl,
          title: data.session.title,
          thumbnailUrl: data.session.thumbnailUrl,
          liveStatus: data.session.liveStatus,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load session");
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const handleModeChange = useCallback(
    async (nextMode: SessionMode) => {
      if (!mode || nextMode === mode || modeSwitching) return;

      const previousMode = mode;
      setModeSwitching(true);
      setModeError(null);
      setMode(nextMode);

      try {
        const { ok, data } = await fetchJson<{
          mode?: SessionMode;
          error?: string;
        }>(`/api/sessions/${sessionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: nextMode }),
        });
        if (!ok) {
          throw new Error(data.error ?? "Could not switch editor mode");
        }
        const updatedSession = session
          ? { ...session, mode: nextMode }
          : null;
        setSession(updatedSession);
        if (updatedSession) {
          writeSessionBootstrap({
            id: updatedSession.id,
            mode: nextMode,
            platform: updatedSession.platform,
            youtubeVideoId: updatedSession.youtubeVideoId,
            youtubeUrl: updatedSession.youtubeUrl,
            title: updatedSession.title,
            thumbnailUrl: updatedSession.thumbnailUrl,
            liveStatus: updatedSession.liveStatus,
          });
        }
      } catch (err) {
        setMode(previousMode);
        setModeError(
          err instanceof Error ? err.message : "Could not switch editor mode"
        );
      } finally {
        setModeSwitching(false);
      }
    },
    [mode, modeSwitching, session, sessionId]
  );

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
    return <EditorWorkspaceSkeleton mode="timeline" />;
  }

  return (
    <>
      {mode === "agent" ? (
        <AgentWorkspace
          sessionId={sessionId}
          modeSwitching={modeSwitching}
          onModeChange={handleModeChange}
        />
      ) : (
        <SessionWorkspace
          sessionId={sessionId}
          initialSession={session}
          modeSwitching={modeSwitching}
          onModeChange={handleModeChange}
        />
      )}
      {modeError && (
        <div
          role="alert"
          className="fixed bottom-4 left-1/2 z-[100] -translate-x-1/2 rounded-md border border-red-400/25 bg-[#1a0d0d] px-4 py-2.5 text-xs text-red-200 shadow-2xl"
        >
          {modeError}
        </div>
      )}
    </>
  );
}
