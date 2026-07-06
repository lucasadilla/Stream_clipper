"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
} from "react";
import type { StreamPlayerHandle } from "@/types/streamPlayer";

declare global {
  interface Window {
    Twitch?: {
      Player: new (
        elementId: string,
        options: {
          width: string | number;
          height: string | number;
          channel?: string;
          video?: string;
          parent: string[];
          autoplay?: boolean;
          muted?: boolean;
        }
      ) => TwitchPlayerInstance;
    };
  }
}

interface TwitchPlayerInstance {
  seek: (seconds: number) => void;
  play: () => void;
  pause: () => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  destroy?: () => void;
  addEventListener: (event: string, callback: () => void) => void;
  removeEventListener: (event: string, callback: () => void) => void;
}

interface TwitchEmbedPlayerProps {
  channel?: string;
  videoId?: string;
  onTimeUpdate?: (time: number) => void;
  onDurationChange?: (duration: number) => void;
  fillContainer?: boolean;
}

function twitchParents(): string[] {
  if (typeof window === "undefined") return ["localhost"];
  const hosts = new Set<string>([
    window.location.hostname,
    "localhost",
    "127.0.0.1",
  ]);
  return [...hosts].filter(Boolean);
}

export const TwitchEmbedPlayer = forwardRef<
  StreamPlayerHandle,
  TwitchEmbedPlayerProps
>(function TwitchEmbedPlayer(
  { channel, videoId, onTimeUpdate, onDurationChange, fillContainer },
  ref
) {
  const reactId = useId().replace(/\W/g, "");
  const containerId = `twitch-player-${reactId}`;
  const playerRef = useRef<TwitchPlayerInstance | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const readyHandlerRef = useRef<(() => void) | null>(null);

  const seekTo = useCallback(
    (seconds: number, options?: { play?: boolean }) => {
      const player = playerRef.current;
      if (!player) return;
      player.seek(seconds);
      if (options?.play === false) {
        player.pause();
      } else {
        player.play();
      }
      window.setTimeout(() => {
        onTimeUpdate?.(player.getCurrentTime());
      }, 80);
    },
    [onTimeUpdate]
  );

  useImperativeHandle(ref, () => ({
    seekTo,
    play: () => playerRef.current?.play(),
    pause: () => playerRef.current?.pause(),
    getCurrentTime: () => playerRef.current?.getCurrentTime() ?? 0,
    getDuration: () => playerRef.current?.getDuration?.() ?? 0,
  }));

  useEffect(() => {
    if (!channel && !videoId) return;

    let cancelled = false;

    function teardown() {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      const player = playerRef.current;
      if (player && readyHandlerRef.current) {
        try {
          player.removeEventListener("ready", readyHandlerRef.current);
        } catch {
          // ignore
        }
      }
      readyHandlerRef.current = null;
      try {
        playerRef.current?.destroy?.();
      } catch {
        // ignore
      }
      playerRef.current = null;
    }

    function initPlayer() {
      if (cancelled || !window.Twitch?.Player) return;

      teardown();

      const options = {
        width: "100%",
        height: "100%",
        parent: twitchParents(),
        autoplay: false,
        muted: false,
        ...(videoId ? { video: videoId } : {}),
        ...(channel && !videoId ? { channel } : {}),
      };

      const player = new window.Twitch.Player(containerId, options);
      playerRef.current = player;

      const reportDuration = () => {
        const d = player.getDuration?.() ?? 0;
        if (d > 0) onDurationChange?.(d);
      };

      const onReady = () => reportDuration();
      readyHandlerRef.current = onReady;
      player.addEventListener("ready", onReady);

      intervalRef.current = setInterval(() => {
        const t = player.getCurrentTime() ?? 0;
        onTimeUpdate?.(t);
        reportDuration();
      }, 500);
    }

    function boot() {
      if (window.Twitch?.Player) {
        initPlayer();
        return;
      }

      const existing = document.querySelector(
        'script[src*="player.twitch.tv/js/embed"]'
      );
      if (existing) {
        if (window.Twitch?.Player) {
          initPlayer();
        } else {
          existing.addEventListener("load", initPlayer, { once: true });
        }
        return;
      }

      const tag = document.createElement("script");
      tag.src = "https://player.twitch.tv/js/embed/v1.js";
      tag.async = true;
      tag.onload = () => initPlayer();
      document.head.appendChild(tag);
    }

    boot();

    return () => {
      cancelled = true;
      teardown();
    };
  }, [channel, videoId, containerId, onTimeUpdate, onDurationChange]);

  if (!channel && !videoId) {
    return (
      <div
        className={
          fillContainer
            ? "relative w-full h-full overflow-hidden bg-black flex items-center justify-center"
            : "relative w-full aspect-video rounded-xl overflow-hidden bg-black border border-[var(--color-card-border)] flex items-center justify-center"
        }
      >
        <p className="text-xs text-[#888] px-4 text-center">
          Twitch channel not found — reload or re-open this session.
        </p>
      </div>
    );
  }

  return (
    <div
      className={
        fillContainer
          ? "relative w-full h-full overflow-hidden bg-black"
          : "relative w-full aspect-video rounded-xl overflow-hidden bg-black border border-[var(--color-card-border)]"
      }
    >
      <div id={containerId} className="absolute inset-0 w-full h-full" />
    </div>
  );
});
