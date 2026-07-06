"use client";

import { useEffect, useRef } from "react";
import type { CaptionCue } from "@/lib/captionTrack";
import { cn } from "@/lib/utils";

function pct(time: number, max: number) {
  return Math.min(100, Math.max(0, (time / max) * 100));
}

export type CaptionDragMode = "cue-start" | "cue-end" | "cue-move";

interface CaptionTimelineTrackProps {
  cues: CaptionCue[];
  maxTime: number;
  currentTime: number;
  height: string;
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
  height,
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
      className="relative bg-[#0a0f14] border-b border-[#2a2a2a] shrink-0 overflow-hidden"
      style={{ height }}
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
                ? "border-[#e8b84a] bg-[#e8b84a]/20 text-[#fff8e8] z-[8] ring-1 ring-[#e8b84a]/50"
                : isActive
                  ? "border-[#7eb8ff] bg-[#7eb8ff]/25 text-[#dceeff] z-[4]"
                  : "border-[#2a4a66] bg-[#152535]/80 text-[#8ab4d4] hover:bg-[#1a3045] z-[2]"
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
                  className="absolute left-0 top-0 bottom-0 w-2 -ml-1 bg-[#e8b84a] cursor-ew-resize z-10 rounded-l-sm"
                  onPointerDown={(e) => onBeginCueDrag("cue-start", e, cue)}
                />
                <div
                  className="absolute right-0 top-0 bottom-0 w-2 -mr-1 bg-[#e8b84a] cursor-ew-resize z-10 rounded-r-sm"
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
