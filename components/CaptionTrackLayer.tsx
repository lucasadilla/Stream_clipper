"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { StreamPlayerHandle } from "@/types/streamPlayer";
import {
  buildCaptionTrack,
  lookupCueAtTime,
  type CaptionCue,
  type TranscriptChunkInput,
} from "@/lib/captionTrack";
import { applyCaptionEdits, type CaptionEditsMap } from "@/lib/captionEdits";
import {
  applyCaptionCapitalization,
  captionPreviewStyle,
  type CaptionAppearance,
} from "@/lib/captionAppearance";
import { cn } from "@/lib/cn";
import type { RefObject } from "react";

interface CaptionTrackLayerProps {
  enabled: boolean;
  playerRef: RefObject<StreamPlayerHandle | null>;
  chunks: TranscriptChunkInput[];
  captionEdits?: CaptionEditsMap;
  appearance: CaptionAppearance;
  showVerticalSafeArea?: boolean;
}

function animationClass(animation: CaptionAppearance["animation"]): string {
  switch (animation) {
    case "fade":
      return "caption-anim-fade";
    case "pop":
      return "caption-anim-pop";
    case "slideUp":
      return "caption-anim-slide-up";
    default:
      return "";
  }
}

export function CaptionTrackLayer({
  enabled,
  playerRef,
  chunks,
  captionEdits = {},
  appearance,
  showVerticalSafeArea = false,
}: CaptionTrackLayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const track = useMemo(() => {
    const built = buildCaptionTrack(
      chunks,
      showVerticalSafeArea ? "vertical" : "native"
    );
    return applyCaptionEdits(built, captionEdits);
  }, [chunks, captionEdits, showVerticalSafeArea]);

  const [activeCue, setActiveCue] = useState<CaptionCue | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [containerHeight, setContainerHeight] = useState(400);
  const activeIdRef = useRef<string | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setContainerHeight(entry?.contentRect.height ?? 400);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const previewStyles = useMemo(
    () => captionPreviewStyle(appearance, containerHeight),
    [appearance, containerHeight]
  );

  useEffect(() => {
    if (!enabled) {
      activeIdRef.current = null;
      setActiveCue(null);
      return;
    }

    let raf = 0;
    let lastPoll = 0;

    const tick = (now: number) => {
      if (now - lastPoll >= 50) {
        lastPoll = now;
        const handle = playerRef.current;
        const t =
          handle && typeof handle.getCurrentTime === "function"
            ? handle.getCurrentTime()
            : 0;
        const cue = lookupCueAtTime(track, t);
        const nextId = cue?.id ?? null;
        if (nextId !== activeIdRef.current) {
          activeIdRef.current = nextId;
          setActiveCue(cue);
        }
        if (appearance.karaokeEnabled) {
          setPlayhead(t);
        }
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [enabled, track, playerRef, appearance.karaokeEnabled]);

  if (!enabled) return null;

  const useKaraoke =
    appearance.karaokeEnabled &&
    activeCue?.words &&
    activeCue.words.length > 0;

  const displayText = activeCue
    ? applyCaptionCapitalization(activeCue.text, appearance.capitalization)
    : null;

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 z-50 pointer-events-none overflow-hidden"
    >
      {showVerticalSafeArea && (
        <div
          className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-[min(56.25%,100%)] border-x border-dashed border-white/15"
          aria-hidden
        />
      )}

      <div style={previewStyles.container}>
        {activeCue && displayText && (
          <p
            key={activeCue.id}
            style={previewStyles.text}
            className={cn(
              "whitespace-pre-line line-clamp-2",
              animationClass(appearance.animation)
            )}
          >
            {useKaraoke
              ? activeCue.words!.map((word, index) => {
                  const active =
                    playhead >= word.start && playhead < word.end;
                  const label = applyCaptionCapitalization(
                    word.word,
                    appearance.capitalization
                  );
                  return (
                    <span key={`${activeCue.id}-${index}`}>
                      <span
                        style={{
                          color: active
                            ? appearance.highlightColor
                            : appearance.color,
                          transition: "color 60ms linear",
                        }}
                      >
                        {label}
                      </span>
                      {index < activeCue.words!.length - 1 ? " " : ""}
                    </span>
                  );
                })
              : displayText}
          </p>
        )}
      </div>
    </div>
  );
}
