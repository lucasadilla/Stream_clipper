"use client";

import { use } from "react";
import dynamic from "next/dynamic";

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

export default function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <SessionWorkspace sessionId={id} />;
}
