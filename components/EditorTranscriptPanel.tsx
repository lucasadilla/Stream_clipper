"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatSeconds } from "@/lib/time";
import { cn } from "@/lib/cn";

export interface EditorTranscriptLine {
  id: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  text: string;
}

interface EditorTranscriptPanelProps {
  chunks: EditorTranscriptLine[];
  currentTime: number;
  onSeek: (seconds: number) => void;
  transcribing?: boolean;
  error?: string | null;
}

export function EditorTranscriptPanel({
  chunks,
  currentTime,
  onSeek,
  transcribing = false,
  error = null,
}: EditorTranscriptPanelProps) {
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return chunks;
    return chunks.filter((chunk) => chunk.text.toLowerCase().includes(q));
  }, [chunks, query]);

  const activeId = useMemo(() => {
    const hit = chunks.find(
      (chunk) =>
        currentTime >= chunk.startTimeSeconds &&
        currentTime < chunk.endTimeSeconds
    );
    return hit?.id ?? null;
  }, [chunks, currentTime]);

  useEffect(() => {
    if (!activeId || query.trim()) return;
    activeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeId, query]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#050705]">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--color-card-border)] px-3 py-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8f9b89]">
          Transcript
        </p>
        {transcribing && (
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)] animate-pulse" />
        )}
        <span className="ml-auto font-mono text-[10px] text-[#71806d]">
          {chunks.length}
        </span>
      </div>

      <div className="shrink-0 border-b border-[var(--color-card-border)] px-2 py-1.5">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search transcript"
          className="h-7 w-full border border-[#21301f] bg-[#070a07] px-2 text-xs text-white placeholder:text-[#5f6b5c] focus:border-[var(--color-accent)] focus:outline-none"
        />
      </div>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <p className="px-3 py-4 text-xs leading-5 text-[var(--color-danger,#ff6b6b)]">
            {error}
          </p>
        ) : filtered.length === 0 ? (
          <p className="px-3 py-4 text-xs leading-5 text-[var(--color-muted)]">
            {chunks.length === 0
              ? transcribing
                ? "Transcribing…"
                : "Transcript appears as audio is processed."
              : "No matching lines."}
          </p>
        ) : (
          <ul className="py-1">
            {filtered.map((chunk) => {
              const active = chunk.id === activeId;
              return (
                <li key={chunk.id}>
                  <button
                    type="button"
                    ref={active ? activeRef : undefined}
                    onClick={() => onSeek(chunk.startTimeSeconds)}
                    className={cn(
                      "flex w-full items-start gap-2 px-3 py-1.5 text-left text-xs leading-5 transition-colors",
                      active
                        ? "bg-[var(--color-accent)]/12 text-white"
                        : "text-[#c5cfc0] hover:bg-[#0c120c] hover:text-white"
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 shrink-0 font-mono text-[10px]",
                        active
                          ? "text-[var(--color-accent)]"
                          : "text-[var(--color-accent)]/70"
                      )}
                    >
                      {formatSeconds(chunk.startTimeSeconds)}
                    </span>
                    <span className="min-w-0 flex-1">{chunk.text}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
