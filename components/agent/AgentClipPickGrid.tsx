"use client";

import { cn } from "@/lib/cn";
import { formatDuration, formatSeconds } from "@/lib/time";
import type { ClipSuggestionData } from "@/components/ClipSuggestionCard";

export interface AgentClipCardData extends ClipSuggestionData {
  thumbnailUrl?: string | null;
}

interface AgentClipPickGridProps {
  clips: AgentClipCardData[];
  selectedIds: Set<string>;
  onToggle: (clipId: string) => void;
  onGetMore?: () => void;
  getMoreLoading?: boolean;
  suggesting?: boolean;
}

export function AgentClipPickGrid({
  clips,
  selectedIds,
  onToggle,
  onGetMore,
  getMoreLoading,
  suggesting,
}: AgentClipPickGridProps) {
  if (suggesting && clips.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--color-accent)] border-t-transparent" />
        <p className="text-sm text-[var(--color-muted)]">
          Finding your top moments…
        </p>
      </div>
    );
  }

  if (clips.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--color-card-border)] px-6 py-12 text-center">
        <p className="text-sm text-[var(--color-foreground)]">
          No auto clips yet — the transcript may still be thin.
        </p>
        <p className="mt-2 text-xs text-[var(--color-muted)]">
          Use “Find another moment” below to describe a clip, or wait for more
          transcript and tap Get more.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-[var(--color-foreground)]">
            Pick your clips
          </h2>
          <p className="text-xs text-[var(--color-muted)]">
            Select the moments you want to edit and export (
            {selectedIds.size} selected).
          </p>
        </div>
        {onGetMore && (
          <button
            type="button"
            onClick={onGetMore}
            disabled={getMoreLoading}
            className="rounded-lg border border-[var(--color-card-border)] px-3 py-1.5 text-xs text-[var(--color-foreground)] hover:border-[var(--color-accent)] disabled:opacity-50"
          >
            {getMoreLoading ? "Finding…" : "Get 5 more"}
          </button>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {clips.map((clip) => {
          const selected = selectedIds.has(clip.id);
          const duration = clip.endTimeSeconds - clip.startTimeSeconds;
          return (
            <button
              key={clip.id}
              type="button"
              onClick={() => onToggle(clip.id)}
              className={cn(
                "group overflow-hidden rounded-xl border text-left transition",
                selected
                  ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 ring-1 ring-[var(--color-accent)]"
                  : "border-[var(--color-card-border)] bg-[var(--color-card)] hover:border-[#4a5a48]"
              )}
            >
              <div className="relative aspect-video bg-[#0a0c0a]">
                {clip.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={clip.thumbnailUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
                    Preview
                  </div>
                )}
                <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">
                  {formatDuration(duration)}
                </span>
                {selected && (
                  <span className="absolute left-2 top-2 rounded bg-[var(--color-accent)] px-1.5 py-0.5 text-[10px] font-semibold text-black">
                    Selected
                  </span>
                )}
              </div>
              <div className="space-y-1.5 p-3">
                <p className="line-clamp-2 text-sm font-medium leading-snug">
                  {clip.title}
                </p>
                <p className="line-clamp-2 text-[11px] text-[var(--color-muted)]">
                  {clip.reason}
                </p>
                <p className="text-[10px] text-[var(--color-muted)]">
                  {formatSeconds(clip.startTimeSeconds)} ·{" "}
                  {Math.round(clip.confidence * 100)}% confidence
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
