"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { YouTubePlayerHandle } from "@/components/YouTubePlayer";
import {
  buildCaptionTrack,
  lookupCueAtTime,
  type TranscriptChunkInput,
} from "@/lib/captionTrack";
import { cn } from "@/lib/utils";
import type { RefObject } from "react";

interface CaptionTrackLayerProps {
  enabled: boolean;
  playerRef: RefObject<YouTubePlayerHandle | null>;
  chunks: TranscriptChunkInput[];
  showVerticalSafeArea?: boolean;
}

/**
 * Caption layer with its own playback clock (reads player ref directly).
 * Rendered above the video iframe — bottom-center placement.
 */
export function CaptionTrackLayer({
  enabled,
  playerRef,
  chunks,
  showVerticalSafeArea = false,
}: CaptionTrackLayerProps) {
  const track = useMemo(
    () => buildCaptionTrack(chunks, showVerticalSafeArea ? "vertical" : "native"),
    [chunks, showVerticalSafeArea]
  );

  const [activeText, setActiveText] = useState<string | null>(null);
  const activeIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      activeIdRef.current = null;
      setActiveText(null);
      return;
    }

    let raf = 0;
    let lastPoll = 0;

    const tick = (now: number) => {
      if (now - lastPoll >= 50) {
        lastPoll = now;
        const t = playerRef.current?.getCurrentTime() ?? 0;
        const cue = lookupCueAtTime(track, t);
        const nextId = cue?.id ?? null;
        if (nextId !== activeIdRef.current) {
          activeIdRef.current = nextId;
          setActiveText(cue?.text ?? null);
        }
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [enabled, track, playerRef]);

  if (!enabled) return null;

  return (
    <div className="absolute inset-0 z-50 pointer-events-none overflow-hidden">
      {showVerticalSafeArea && (
        <div
          className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-[min(56.25%,100%)] border-x border-dashed border-white/15"
          aria-hidden
        />
      )}

      <div className="flex h-full w-full flex-col items-center justify-end pb-[10%] px-[5%]">
        {activeText && (
          <p
            className={cn(
              "max-w-full text-center font-bold leading-snug text-white",
              "text-[clamp(14px,2.2vw,22px)]",
              "px-3 py-1.5 rounded-md",
              "bg-black/80",
              "drop-shadow-[0_2px_10px_rgba(0,0,0,1)]",
              "whitespace-pre-line line-clamp-2"
            )}
          >
            {activeText}
          </p>
        )}
      </div>
    </div>
  );
}
