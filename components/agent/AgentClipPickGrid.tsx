"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Clock3, Play, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatDuration, formatSeconds } from "@/lib/time";
import type { ClipSuggestionData } from "@/components/ClipSuggestionCard";
import {
  preloadClipStudio,
  preloadClipStudioFaceTracker,
} from "@/lib/clipStudioPreload";
import { OperationProgress } from "@/components/ui/operation-progress";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

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
  isLive?: boolean;
  onOpenAssistant?: () => void;
  sessionId?: string;
  playbackUrl?: string | null;
}

const SORTS: Array<{ id: ClipSort; label: string }> = [
  { id: "newest", label: "Newest" },
  { id: "oldest", label: "Oldest" },
  { id: "best", label: "Most likely" },
];

const CARD_ACCENTS = ["#65d8c1", "#f0b75a", "#ff7d78"] as const;

function ClipCardPlaceholder({
  label,
  announce = false,
}: {
  label: string;
  announce?: boolean;
}) {
  return (
    <div
      className="overflow-hidden rounded-lg border border-white/[0.08] bg-[#0d0f12]"
      aria-label={announce ? label : undefined}
      aria-hidden={announce ? undefined : true}
      role={announce ? "status" : undefined}
    >
      <div className="clipper-skeleton aspect-[9/16] w-full bg-white/[0.055]" />
      <div className="h-[9.75rem] space-y-3 p-4">
        <div className="clipper-skeleton h-4 w-4/5 rounded bg-white/[0.055]" />
        <div className="clipper-skeleton h-3 w-full rounded bg-white/[0.055]" />
        <div className="clipper-skeleton h-3 w-2/3 rounded bg-white/[0.055]" />
      </div>
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function AgentClipPickGrid({
  clips,
  onOpenClip,
  onGetMore,
  getMoreLoading,
  suggesting,
  isLive = false,
  onOpenAssistant,
  sessionId,
  playbackUrl,
}: AgentClipPickGridProps) {
  const [sort, setSort] = useState<ClipSort>("best");
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (clips.length > 0) preloadClipStudioFaceTracker();
  }, [clips.length]);

  const warmClip = (clip: AgentClipCardData) => {
    if (!sessionId) return;
    preloadClipStudio({
      sessionId,
      startSeconds: clip.startTimeSeconds,
      endSeconds: clip.endTimeSeconds,
      playbackUrl,
    });
  };
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
      <div className="mx-auto w-full max-w-[96rem] space-y-6 pb-8" aria-busy="true">
        <div className="flex min-h-24 items-end justify-between gap-8 border-b border-white/[0.09] pb-5">
          <OperationProgress
            title="Finding standout moments"
            stages={[
              "Reading the transcript…",
              "Scoring hooks and payoffs…",
              "Checking clip boundaries…",
              "Writing accurate titles…",
              "Ranking the strongest moments…",
            ]}
            resetKey={`clip-search:${sessionId ?? "session"}`}
            className="max-w-md"
          />
          <div className="clipper-skeleton hidden h-10 w-72 rounded-md bg-white/[0.055] sm:block" />
        </div>
        <div
          className="grid justify-center gap-4"
          style={{ gridTemplateColumns: "repeat(auto-fit, 16rem)" }}
        >
          {Array.from({ length: 4 }, (_, index) => (
            <ClipCardPlaceholder key={index} label="Finding a clip" />
          ))}
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
              className="rounded-md border border-[#f0b75a] bg-[#f0b75a] px-3 py-2 text-xs font-semibold text-[#1b1203] transition-colors hover:bg-[#f7c974]"
            >
              Ask assistant
            </button>
          )}
          {onGetMore && (
            <button
              type="button"
              onClick={onGetMore}
              disabled={getMoreLoading}
              className="rounded-md border border-white/10 px-3 py-2 text-xs text-white hover:border-[#65d8c1]/50 disabled:opacity-50"
            >
              {getMoreLoading ? "Searching…" : "Search again"}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[96rem] space-y-6 pb-8">
      <div className="flex flex-col gap-5 border-b border-white/[0.09] pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl">
          <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#65d8c1]">
            {isLive && (
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#65d8c1]" />
            )}
            {isLive ? "Watching live" : "AI selections"}
          </div>
          <h1 className="text-2xl font-semibold text-white md:text-3xl">
            Pick a moment
          </h1>
          <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">
            {clips.length} clip{clips.length === 1 ? "" : "s"} found. Choose a
            moment to refine the framing, captions, and export.
          </p>
        </div>

        <div className="flex w-full flex-col items-stretch justify-end gap-2 sm:flex-row sm:items-center">
          <div
            className="grid h-10 rounded-md border border-white/10 bg-[#0d0f12] p-1"
            style={{
              width: "min(100%, 18rem)",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            }}
            aria-label="Sort clip suggestions"
          >
            {SORTS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setSort(option.id)}
                aria-pressed={sort === option.id}
                className={cn(
                  "min-w-0 whitespace-nowrap px-2 text-[11px] font-semibold transition-colors sm:px-3",
                  sort === option.id
                    ? "rounded-sm bg-[#e9e5db] text-[#141512]"
                    : "text-[var(--color-muted)] hover:bg-white/[0.03] hover:text-white"
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
              className="h-10 shrink-0 rounded-md border border-[#f0b75a]/35 bg-[#17130d] px-4 text-[11px] font-semibold text-[#f0c879] transition hover:border-[#f0b75a] hover:bg-[#20180d] disabled:cursor-wait disabled:opacity-50"
            >
              {getMoreLoading ? "Searching…" : "Find more"}
            </button>
          )}
        </div>
      </div>

      <motion.div
        className="grid justify-center gap-4"
        style={{ gridTemplateColumns: "repeat(auto-fit, 16rem)" }}
      >
        <AnimatePresence initial={false} mode="popLayout">
          {sortedClips.map((clip, index) => {
            const duration = clip.endTimeSeconds - clip.startTimeSeconds;
            const confidence = Math.round(clip.confidence * 100);
            const cardAccent = CARD_ACCENTS[index % CARD_ACCENTS.length];
            return (
              <motion.div
                layout={reduceMotion ? false : "position"}
                initial={
                  reduceMotion ? false : { opacity: 0, scale: 0.98, y: 10 }
                }
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={reduceMotion ? undefined : { opacity: 0, scale: 0.98 }}
                transition={{
                  duration: reduceMotion ? 0 : 0.2,
                  ease: "easeOut",
                }}
                key={clip.id}
                className="h-full"
              >
                <button
                  type="button"
                  onPointerEnter={() => warmClip(clip)}
                  onFocus={() => warmClip(clip)}
                  onTouchStart={() => warmClip(clip)}
                  onClick={() => {
                    warmClip(clip);
                    onOpenClip(clip.id);
                  }}
                  className="group flex h-full w-full min-w-0 origin-center flex-col overflow-hidden rounded-lg border border-t-2 border-[#292d31] bg-[#0d0f12] text-left shadow-[0_12px_32px_rgba(0,0,0,0.24)] transition-[border-color,background-color,transform,box-shadow] duration-300 ease-out hover:-translate-y-1.5 hover:scale-[1.015] hover:border-[#596168] hover:bg-[#111419] hover:shadow-[0_24px_52px_rgba(0,0,0,0.48)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#65d8c1] motion-reduce:hover:translate-y-0 motion-reduce:hover:scale-100"
                  style={{ borderTopColor: cardAccent }}
                >
              <div className="relative aspect-[9/16] w-full shrink-0 overflow-hidden border-b border-white/[0.08] bg-[#050607]">
                <div
                  className="absolute inset-0 animate-pulse bg-[#15191d] motion-reduce:animate-none"
                  aria-hidden="true"
                />
                {clip.thumbnailUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={clip.thumbnailUrl}
                    alt={`Preview for ${clip.title}`}
                    className="absolute inset-0 h-full w-full object-cover object-center opacity-0 transition-[transform,filter,opacity] duration-500 ease-out group-hover:scale-[1.055] group-hover:brightness-110 group-hover:saturate-[1.08] motion-reduce:group-hover:scale-100"
                    loading="lazy"
                    onLoad={(event) => {
                      event.currentTarget.style.opacity = "0.9";
                    }}
                    onError={(event) => {
                      const image = event.currentTarget;
                      const retries = Number(image.dataset.retry ?? "0");
                      image.style.opacity = "0";
                      if (retries >= 8) {
                        return;
                      }
                      image.dataset.retry = String(retries + 1);
                      const base = clip.thumbnailUrl ?? image.src;
                      window.setTimeout(() => {
                        image.src = `${base}${base.includes("?") ? "&" : "?"}retry=${retries + 1}&t=${Date.now()}`;
                      }, Math.min(8_000, 700 * 1.6 ** retries));
                    }}
                  />
                )}
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/75 via-black/5 to-black/20" />
                <div className="absolute left-3 top-3 rounded-md border border-white/10 bg-black/65 px-2 py-1 text-[9px] font-semibold text-white/90 backdrop-blur-md">
                  #{String(index + 1).padStart(2, "0")}
                </div>
                <div className="absolute right-3 top-3 flex items-center gap-1.5 rounded-md border border-[#95ff00]/25 bg-black/65 px-2 py-1 text-[9px] font-semibold tabular-nums text-[#b8ff70] backdrop-blur-md">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#95ff00]" />
                  {confidence}%
                </div>
                <div className="absolute inset-0 grid place-items-center">
                  <span className="grid h-10 w-10 place-items-center rounded-full border border-white/20 bg-black/55 text-white shadow-[0_8px_24px_rgba(0,0,0,0.35)] backdrop-blur-md transition-[transform,border-color,background-color,color,box-shadow] duration-300 ease-out group-hover:scale-110 group-hover:border-[#95ff00]/70 group-hover:bg-[#95ff00] group-hover:text-[#0b0d0c] group-hover:shadow-[0_10px_30px_rgba(149,255,0,0.22)] motion-reduce:group-hover:scale-100">
                    <Play className="ml-0.5 h-3.5 w-3.5 fill-current" aria-hidden="true" />
                  </span>
                </div>
                <div className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-md bg-black/60 px-2 py-1 text-[9px] font-medium text-[#f1d093] backdrop-blur-md">
                  <Clock3 className="h-3 w-3 text-[#f0b75a]" aria-hidden="true" />
                  {formatSeconds(clip.startTimeSeconds)} · {formatDuration(duration)}
                </div>
              </div>

              <div
                className="flex w-full shrink-0 flex-col p-4 transition-transform duration-300 ease-out group-hover:-translate-y-0.5 motion-reduce:group-hover:translate-y-0"
                style={{ height: "9.75rem" }}
              >
                <h2
                  className="line-clamp-2 overflow-hidden text-sm font-semibold leading-5 text-white"
                  style={{ height: "2.5rem" }}
                >
                  {clip.title}
                </h2>
                <p
                  className="mt-2 line-clamp-2 overflow-hidden text-[10px] leading-[1.125rem] text-[var(--color-muted)]"
                  style={{ height: "2.25rem" }}
                >
                  {clip.reason}
                </p>

                <div className="mt-auto flex items-center justify-between border-t border-white/[0.08] pt-3 text-[9px] font-semibold uppercase tracking-[0.12em]">
                  <span className="text-[var(--color-muted)]">Open in studio</span>
                  <ArrowUpRight
                    className="h-3.5 w-3.5 text-[#65d8c1] transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                    aria-hidden="true"
                  />
                </div>
              </div>
                </button>
              </motion.div>
            );
          })}
          {(getMoreLoading || suggesting) && (
            <motion.div
              key="clip-search-placeholder"
              layout={reduceMotion ? false : "position"}
              initial={reduceMotion ? false : { opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={reduceMotion ? undefined : { opacity: 0, scale: 0.98 }}
              transition={{ duration: reduceMotion ? 0 : 0.18 }}
            >
              <ClipCardPlaceholder label="Finding another clip" announce />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
