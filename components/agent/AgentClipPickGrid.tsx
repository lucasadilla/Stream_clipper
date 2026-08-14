"use client";

import { useMemo, useState } from "react";
import { ArrowUpRight, Clock3, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatDuration, formatSeconds } from "@/lib/time";
import type { ClipSuggestionData } from "@/components/ClipSuggestionCard";

export interface AgentClipCardData extends ClipSuggestionData {
  thumbnailUrl?: string | null;
}

type ClipSort = "newest" | "oldest" | "best";

interface AgentClipPickGridProps {
  clips: AgentClipCardData[];
  onOpenClip: (clipId: string) => void;
  onGetMore?: () => void;
  getMoreLoading?: boolean;
  suggesting?: boolean;
  findingElapsedSec?: number;
  isLive?: boolean;
  onOpenAssistant?: () => void;
}

const SORTS: Array<{ id: ClipSort; label: string }> = [
  { id: "newest", label: "Newest" },
  { id: "oldest", label: "Oldest" },
  { id: "best", label: "Most likely" },
];

export function AgentClipPickGrid({
  clips,
  onOpenClip,
  onGetMore,
  getMoreLoading,
  suggesting,
  findingElapsedSec = 0,
  isLive = false,
  onOpenAssistant,
}: AgentClipPickGridProps) {
  const [sort, setSort] = useState<ClipSort>("newest");
  const sortedClips = useMemo(() => {
    const indexed = clips.map((clip, index) => ({ clip, index }));
    if (sort === "oldest") return indexed.reverse().map(({ clip }) => clip);
    if (sort === "best") {
      return indexed
        .sort(
          (a, b) =>
            b.clip.confidence - a.clip.confidence || a.index - b.index
        )
        .map(({ clip }) => clip);
    }
    return indexed.map(({ clip }) => clip);
  }, [clips, sort]);

  if (suggesting && clips.length === 0) {
    return (
      <div className="flex min-h-[26rem] flex-col items-center justify-center gap-4 border-y border-[var(--color-card-border)] text-center">
        <div className="relative grid h-14 w-14 place-items-center border border-[var(--color-accent)]/35 bg-[var(--color-accent)]/10">
          <Sparkles className="h-5 w-5 text-[var(--color-accent)]" />
          <span className="absolute inset-[-1px] animate-pulse border border-[var(--color-accent)]/20" />
        </div>
        <div>
          <p className="text-base font-semibold text-white">Finding standout moments</p>
          <p className="mt-1 text-xs text-[var(--color-muted)]">
            Reading the transcript and scoring each moment
            {findingElapsedSec > 0 ? ` · ${findingElapsedSec}s` : ""}
          </p>
        </div>
      </div>
    );
  }

  if (clips.length === 0) {
    return (
      <div className="flex min-h-[24rem] flex-col items-center justify-center border-y border-dashed border-[var(--color-card-border)] px-6 text-center">
        <Sparkles className="mb-4 h-6 w-6 text-[var(--color-accent)]" />
        <p className="text-base font-medium text-white">No suggestions yet</p>
        <p className="mt-2 max-w-md text-xs leading-5 text-[var(--color-muted)]">
          Ask the assistant for a specific moment, or let Clipper search the
          transcript again.
        </p>
        <div className="mt-5 flex gap-2">
          {onOpenAssistant && (
            <button
              type="button"
              onClick={onOpenAssistant}
              className="border border-[var(--color-accent)] bg-[var(--color-accent)] px-3 py-2 text-xs font-semibold text-black"
            >
              Ask assistant
            </button>
          )}
          {onGetMore && (
            <button
              type="button"
              onClick={onGetMore}
              disabled={getMoreLoading}
              className="border border-[var(--color-card-border)] px-3 py-2 text-xs text-white hover:border-[var(--color-accent)] disabled:opacity-50"
            >
              {getMoreLoading ? "Searching…" : "Search again"}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 border-b border-[var(--color-card-border)] pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-accent)]">
            {isLive && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-accent)]" />}
            {isLive ? "Watching live" : "AI selections"}
          </div>
          <h1 className="text-2xl font-semibold text-white md:text-3xl">Pick a moment</h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            {clips.length} clip{clips.length === 1 ? "" : "s"} found. Open any
            moment to refine its look, captions, and export.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex h-9 items-center border border-[var(--color-card-border)] bg-[#070907] p-0.5">
            {SORTS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setSort(option.id)}
                className={cn(
                  "h-8 px-3 text-[11px] font-medium transition-colors",
                  sort === option.id
                    ? "bg-[#20251f] text-white"
                    : "text-[var(--color-muted)] hover:text-white"
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
          {onGetMore && (
            <button
              type="button"
              onClick={onGetMore}
              disabled={getMoreLoading}
              className="h-9 border border-[var(--color-card-border)] px-3 text-[11px] font-semibold text-white transition hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] disabled:opacity-50"
            >
              {getMoreLoading ? "Searching…" : "Find more"}
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-px overflow-hidden border border-[var(--color-card-border)] bg-[var(--color-card-border)] sm:grid-cols-2 xl:grid-cols-3">
        {sortedClips.map((clip, index) => {
          const duration = clip.endTimeSeconds - clip.startTimeSeconds;
          const confidence = Math.round(clip.confidence * 100);
          return (
            <button
              key={clip.id}
              type="button"
              onClick={() => onOpenClip(clip.id)}
              className="group min-w-0 bg-[#080a08] text-left transition-colors hover:bg-[#0d110d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-accent)]"
            >
              <div className="relative aspect-video overflow-hidden bg-[#030403]">
                {clip.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={clip.thumbnailUrl}
                    alt=""
                    className="h-full w-full object-cover opacity-90 transition duration-300 group-hover:scale-[1.02] group-hover:opacity-100"
                    loading="lazy"
                    onError={(event) => {
                      const image = event.currentTarget;
                      const retries = Number(image.dataset.retry ?? "0");
                      if (retries >= 3) {
                        image.style.display = "none";
                        return;
                      }
                      image.dataset.retry = String(retries + 1);
                      const base = clip.thumbnailUrl ?? image.src;
                      window.setTimeout(() => {
                        image.src = `${base}${base.includes("?") ? "&" : "?"}retry=${retries + 1}&t=${Date.now()}`;
                      }, 800 * (retries + 1));
                    }}
                  />
                ) : (
                  <div className="grid h-full place-items-center">
                    <Sparkles className="h-5 w-5 text-[#596256]" />
                  </div>
                )}
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-black/10" />
                <div className="absolute left-3 top-3 border border-white/15 bg-black/70 px-2 py-1 text-[10px] font-semibold text-white backdrop-blur-sm">
                  #{String(index + 1).padStart(2, "0")}
                </div>
                <div className="absolute bottom-3 left-3 flex items-center gap-1.5 text-[10px] font-medium text-white">
                  <Clock3 className="h-3 w-3" />
                  {formatDuration(duration)} · {formatSeconds(clip.startTimeSeconds)}
                </div>
                <span className="absolute bottom-3 right-3 flex translate-y-1 items-center gap-1 bg-[var(--color-accent)] px-2 py-1 text-[10px] font-semibold text-black opacity-0 transition group-hover:translate-y-0 group-hover:opacity-100">
                  Open clip <ArrowUpRight className="h-3 w-3" />
                </span>
              </div>

              <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="line-clamp-2 text-[15px] font-semibold leading-5 text-white">
                    {clip.title}
                  </h2>
                  <span className="shrink-0 text-[10px] font-semibold tabular-nums text-[var(--color-accent)]">
                    {confidence}%
                  </span>
                </div>
                <p className="mt-2 line-clamp-2 min-h-8 text-[11px] leading-4 text-[var(--color-muted)]">
                  {clip.reason}
                </p>
                <div className="mt-4 h-px bg-[#1a1f19]">
                  <div
                    className="h-px bg-[var(--color-accent)]"
                    style={{ width: `${confidence}%` }}
                  />
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
