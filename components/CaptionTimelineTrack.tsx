"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import type { CaptionCue } from "@/lib/captionTrack";
import { cn } from "@/lib/cn";

function pct(time: number, max: number) {
  return Math.min(100, Math.max(0, (time / max) * 100));
}

export type CaptionDragMode = "cue-start" | "cue-end" | "cue-move";

interface CaptionTimelineTrackProps {
  cues: CaptionCue[];
  maxTime: number;
  currentTime: number;
  style?: CSSProperties;
  selectedCueId: string | null;
  onSelectCue: (cueId: string | null) => void;
  onSeek: (seconds: number) => void;
  onBeginCueDrag: (
    mode: CaptionDragMode,
    e: React.PointerEvent,
    cue: CaptionCue
  ) => void;
  trackRef: React.RefObject<HTMLDivElement | null>;
}

export function CaptionTimelineTrack({
  cues,
  maxTime,
  currentTime,
  style,
  selectedCueId,
  onSelectCue,
  onSeek,
  onBeginCueDrag,
  trackRef,
}: CaptionTimelineTrackProps) {
  const selectedRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!selectedCueId) return;
    selectedRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "nearest",
    });
  }, [selectedCueId]);

  return (
    <div
      ref={trackRef}
      className="relative min-h-[36px] overflow-hidden border-b border-[var(--color-card-border)] bg-[#040804]"
      style={style}
      onPointerDown={() => onSelectCue(null)}
    >
      {cues.map((cue) => {
        const isActive =
          currentTime >= cue.startTimeSeconds &&
          currentTime < cue.endTimeSeconds;
        const isSelected = selectedCueId === cue.id;

        return (
          <div
            key={cue.id}
            ref={isSelected ? selectedRef : undefined}
            className={cn(
              "absolute top-1 bottom-1 rounded-sm border text-left overflow-visible",
              "px-1 py-0.5 text-[9px] leading-tight",
              isSelected
                ? "border-[var(--color-accent)] bg-[var(--color-accent)]/20 text-[#f4fff1] z-[8] ring-1 ring-[var(--color-accent)]/45"
                : isActive
                  ? "border-[#d7ff64]/70 bg-[#95ff00]/18 text-[#f4fff1] z-[4]"
                  : "border-[#335221] bg-[#0c1609]/88 text-[#b9d7aa] hover:bg-[#12220d] z-[2]"
            )}
            style={{
              left: `${pct(cue.startTimeSeconds, maxTime)}%`,
              width: `${Math.max(
                pct(cue.endTimeSeconds - cue.startTimeSeconds, maxTime),
                0.35
              )}%`,
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {isSelected && (
              <>
                <div
                  className="absolute left-0 top-0 bottom-0 w-2 -ml-1 bg-[var(--color-accent)] cursor-ew-resize z-10 rounded-l-sm"
                  onPointerDown={(e) => onBeginCueDrag("cue-start", e, cue)}
                />
                <div
                  className="absolute right-0 top-0 bottom-0 w-2 -mr-1 bg-[var(--color-accent)] cursor-ew-resize z-10 rounded-r-sm"
                  onPointerDown={(e) => onBeginCueDrag("cue-end", e, cue)}
                />
                <div
                  className="absolute inset-x-2 inset-y-0 cursor-grab active:cursor-grabbing"
                  onPointerDown={(e) => onBeginCueDrag("cue-move", e, cue)}
                />
              </>
            )}

            <button
              type="button"
              title={cue.text}
              onClick={() => {
                onSelectCue(cue.id);
                onSeek(cue.startTimeSeconds);
              }}
              className={cn(
                "w-full h-full text-left truncate",
                isSelected ? "pointer-events-none" : "cursor-pointer"
              )}
            >
              {cue.text.replace(/\n/g, " ")}
            </button>
          </div>
        );
      })}
    </div>
  );
}
