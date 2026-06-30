"use client";

import Link from "next/link";
import { EditorHeader } from "@/components/layout/EditorHeader";

export default function SessionError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen flex flex-col bg-[var(--color-background)]">
      <EditorHeader title="Editor" />
      <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-lg font-semibold">Something went wrong loading the editor</h1>
        <p className="text-sm text-[var(--color-muted)] max-w-md">
          {error.message || "The page failed to load. Try again or start a new session."}
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={reset}
            className="text-sm px-4 py-2 rounded-lg bg-[var(--color-accent)] text-white"
          >
            Try again
          </button>
          <Link
            href="/"
            className="text-sm px-4 py-2 rounded-lg border border-[var(--color-card-border)] text-[var(--color-muted)] hover:text-white"
          >
            Home
          </Link>
        </div>
      </div>
    </div>
  );
}
