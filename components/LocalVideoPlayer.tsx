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
  initialTime?: number;
  posterUrl?: string | null;
  onTimeUpdate?: (time: number) => void;
  onDurationChange?: (duration: number) => void;
  onFrameReady?: () => void;
  onError?: () => void;
  fillContainer?: boolean;
}

/** Strip cache-bust `v=` so path identity stays stable across remux rewrites. */
function mediaIdentity(src: string): string {
  try {
    const url = new URL(src, "http://local");
    url.searchParams.delete("v");
    return `${url.pathname}${url.search}`;
  } catch {
    return src.split("?")[0] || src;
  }
}

function cacheVersion(src: string): string {
  try {
    return new URL(src, "http://local").searchParams.get("v") ?? "";
  } catch {
    return "";
  }
}

export const LocalVideoPlayer = forwardRef<
  StreamPlayerHandle,
  LocalVideoPlayerProps
>(function LocalVideoPlayer(
  {
    src,
    initialTime = 0,
    posterUrl,
    onTimeUpdate,
    onDurationChange,
    onFrameReady,
    onError,
    fillContainer,
  },
  ref
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const loadedIdentityRef = useRef<string | null>(null);
  const loadedVersionRef = useRef<string | null>(null);
  const onTimeUpdateRef = useRef(onTimeUpdate);
  const onDurationChangeRef = useRef(onDurationChange);
  const onFrameReadyRef = useRef(onFrameReady);
  const onErrorRef = useRef(onError);
  const initialTimeRef = useRef(initialTime);
  const pendingSeekRef = useRef<{ seconds: number; play: boolean } | null>(null);
  onTimeUpdateRef.current = onTimeUpdate;
  onDurationChangeRef.current = onDurationChange;
  onFrameReadyRef.current = onFrameReady;
  onErrorRef.current = onError;

  const seekTo = useCallback(
    (seconds: number, options?: { play?: boolean }) => {
      const video = videoRef.current;
      if (!video) return;
      const play = options?.play !== false;
      if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
        pendingSeekRef.current = { seconds, play };
        return;
      }
      const duration = Number.isFinite(video.duration) ? video.duration : Infinity;
      video.currentTime = Math.max(0, Math.min(seconds, Math.max(0, duration - 0.05)));
      if (!play) {
        void video.pause();
      } else {
        void video.play().catch(() => {});
      }
      onTimeUpdateRef.current?.(video.currentTime);
    },
    []
  );

  useImperativeHandle(ref, () => ({
    seekTo,
    play: () => void videoRef.current?.play().catch(() => {}),
    pause: () => videoRef.current?.pause(),
    getCurrentTime: () => videoRef.current?.currentTime ?? 0,
    getDuration: () => videoRef.current?.duration ?? 0,
  }));

  // Reload whenever the remux `v=` changes so scrubbing length grows with capture.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const identity = mediaIdentity(src);
    const version = cacheVersion(src);
    if (
      loadedIdentityRef.current === identity &&
      loadedVersionRef.current === version &&
      video.getAttribute("src")
    ) {
      if (Number.isFinite(video.duration) && video.duration > 0) {
        onDurationChangeRef.current?.(video.duration);
      }
      return;
    }

    const previousTime = video.currentTime;
    const wasPaused = video.paused;
    loadedIdentityRef.current = identity;
    loadedVersionRef.current = version;
    video.setAttribute("src", src);
    video.load();
    const restore = () => {
      const pending = pendingSeekRef.current;
      pendingSeekRef.current = null;
      const requestedTime =
        pending?.seconds ??
        (previousTime > 0.25 && Number.isFinite(previousTime)
          ? previousTime
          : initialTimeRef.current);
      const needsSeek = Math.abs(requestedTime - previousTime) > 0.05;
      if (Number.isFinite(requestedTime)) {
        try {
          const duration = Number.isFinite(video.duration)
            ? video.duration
            : requestedTime;
          video.currentTime = Math.max(
            0,
            Math.min(requestedTime, Math.max(0, duration - 0.05))
          );
        } catch {
          // ignore seek before ready
        }
      }
      if (pending ? pending.play : !wasPaused) {
        void video.play().catch(() => {});
      } else {
        void video.pause();
      }
      if (Number.isFinite(video.duration) && video.duration > 0) {
        onDurationChangeRef.current?.(video.duration);
      }
      if (!needsSeek) {
        requestAnimationFrame(() => onFrameReadyRef.current?.());
      }
    };
    video.addEventListener("loadeddata", restore, { once: true });
    return () => video.removeEventListener("loadeddata", restore);
  }, [src]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onLoaded = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) {
        onDurationChangeRef.current?.(video.duration);
      }
    };
    const onSeeked = () => onFrameReadyRef.current?.();
    const onTime = () => onTimeUpdateRef.current?.(video.currentTime);
    const onDuration = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) {
        onDurationChangeRef.current?.(video.duration);
      }
    };
    const onMediaError = () => {
      onErrorRef.current?.();
    };
    const onStalled = () => {
      // Empty/corrupt preview often stalls with no frames — fall back after a beat.
      if (video.readyState < 2 && video.networkState === HTMLMediaElement.NETWORK_IDLE) {
        window.setTimeout(() => {
          if (video.readyState < 2) onErrorRef.current?.();
        }, 2500);
      }
    };

    video.addEventListener("loadedmetadata", onLoaded);
    video.addEventListener("durationchange", onDuration);
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onMediaError);
    video.addEventListener("stalled", onStalled);

    return () => {
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("durationchange", onDuration);
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onMediaError);
      video.removeEventListener("stalled", onStalled);
    };
  }, [src]);

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
        poster={posterUrl ?? undefined}
        className="absolute inset-0 w-full h-full object-contain bg-black"
        controls
        playsInline
        preload="auto"
      />
    </div>
  );
});
