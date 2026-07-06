"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import type { StreamPlayerHandle } from "@/types/streamPlayer";

interface LocalVideoPlayerProps {
  src: string;
  onTimeUpdate?: (time: number) => void;
  onDurationChange?: (duration: number) => void;
  fillContainer?: boolean;
}

export const LocalVideoPlayer = forwardRef<
  StreamPlayerHandle,
  LocalVideoPlayerProps
>(function LocalVideoPlayer(
  { src, onTimeUpdate, onDurationChange, fillContainer },
  ref
) {
  const videoRef = useRef<HTMLVideoElement>(null);

  const seekTo = useCallback(
    (seconds: number, options?: { play?: boolean }) => {
      const video = videoRef.current;
      if (!video) return;
      video.currentTime = Math.max(0, seconds);
      if (options?.play === false) {
        void video.pause();
      } else {
        void video.play().catch(() => {});
      }
      onTimeUpdate?.(video.currentTime);
    },
    [onTimeUpdate]
  );

  useImperativeHandle(ref, () => ({
    seekTo,
    play: () => void videoRef.current?.play(),
    pause: () => videoRef.current?.pause(),
    getCurrentTime: () => videoRef.current?.currentTime ?? 0,
    getDuration: () => videoRef.current?.duration ?? 0,
  }));

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const previousTime = video.currentTime;
    const wasPaused = video.paused;
    video.load();
    if (previousTime > 0 && Number.isFinite(previousTime)) {
      video.currentTime = previousTime;
    }
    if (!wasPaused) {
      void video.play().catch(() => {});
    }
  }, [src]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onLoaded = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) {
        onDurationChange?.(video.duration);
      }
    };
    const onTime = () => onTimeUpdate?.(video.currentTime);
    const onDuration = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) {
        onDurationChange?.(video.duration);
      }
    };

    video.addEventListener("loadedmetadata", onLoaded);
    video.addEventListener("durationchange", onDuration);
    video.addEventListener("timeupdate", onTime);

    return () => {
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("durationchange", onDuration);
      video.removeEventListener("timeupdate", onTime);
    };
  }, [src, onTimeUpdate, onDurationChange]);

  return (
    <div
      className={
        fillContainer
          ? "relative w-full h-full overflow-hidden bg-black"
          : "relative w-full aspect-video rounded-xl overflow-hidden bg-black border border-[var(--color-card-border)]"
      }
    >
      <video
        ref={videoRef}
        src={src}
        className="absolute inset-0 w-full h-full object-contain bg-black"
        controls
        playsInline
        preload="metadata"
      />
    </div>
  );
});
