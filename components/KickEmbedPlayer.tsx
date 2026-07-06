"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import type { StreamPlayerHandle } from "@/types/streamPlayer";

interface KickEmbedPlayerProps {
  channel: string;
  onTimeUpdate?: (time: number) => void;
  onDurationChange?: (duration: number) => void;
  fillContainer?: boolean;
}

export const KickEmbedPlayer = forwardRef<
  StreamPlayerHandle,
  KickEmbedPlayerProps
>(function KickEmbedPlayer(
  { channel, onTimeUpdate, onDurationChange, fillContainer },
  ref
) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const seekTo = useCallback(
    (seconds: number, options?: { play?: boolean }) => {
      // Kick iframe has no public seek API — timeline scrub uses local file when available.
      onTimeUpdate?.(seconds);
      if (options?.play === false) return;
    },
    [onTimeUpdate]
  );

  useImperativeHandle(ref, () => ({
    seekTo,
    play: () => {},
    pause: () => {},
    getCurrentTime: () => 0,
    getDuration: () => 0,
  }));

  useEffect(() => {
    onDurationChange?.(0);
  }, [channel, onDurationChange]);

  const src = `https://player.kick.com/${encodeURIComponent(channel)}`;

  return (
    <div
      className={
        fillContainer
          ? "relative w-full h-full overflow-hidden bg-black"
          : "relative w-full aspect-video rounded-xl overflow-hidden bg-black border border-[var(--color-card-border)]"
      }
    >
      <iframe
        ref={iframeRef}
        src={src}
        className="absolute inset-0 w-full h-full border-0"
        allow="autoplay; fullscreen; picture-in-picture"
        allowFullScreen
        title={`Kick stream: ${channel}`}
      />
    </div>
  );
});
