"use client";

import {
  useEffect,
  useRef,
  useImperativeHandle,
  forwardRef,
  useCallback,
} from "react";

import type { StreamPlayerHandle } from "@/types/streamPlayer";

declare global {
  interface Window {
    YT: typeof YT;
    onYouTubeIframeAPIReady: () => void;
  }
}

export type YouTubePlayerHandle = StreamPlayerHandle;

interface YouTubePlayerProps {
  videoId: string;
  onTimeUpdate?: (time: number) => void;
  onDurationChange?: (duration: number) => void;
  /** When true, player fills its parent height instead of using aspect-video */
  fillContainer?: boolean;
}

function isYtPlayerReady(
  player: YT.Player | null | undefined
): player is YT.Player {
  return (
    !!player &&
    typeof player.seekTo === "function" &&
    typeof player.getCurrentTime === "function"
  );
}

function loadYouTubeIframeApi(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.YT?.Player) return Promise.resolve();

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      if (!window.YT?.Player) return;
      settled = true;
      clearInterval(poll);
      resolve();
    };

    const poll = window.setInterval(finish, 50);

    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      finish();
    };

    const existing = document.querySelector('script[src*="youtube.com/iframe_api"]');
    if (!existing) {
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(tag);
    } else {
      finish();
    }
  });
}

export const YouTubePlayer = forwardRef<YouTubePlayerHandle, YouTubePlayerProps>(
  function YouTubePlayer(
    { videoId, onTimeUpdate, onDurationChange, fillContainer },
    ref
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const playerRef = useRef<YT.Player | null>(null);
    const readyRef = useRef(false);
    const pendingSeekRef = useRef<{ seconds: number; play: boolean } | null>(
      null
    );
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
      null
    );
    const onTimeUpdateRef = useRef(onTimeUpdate);
    const onDurationChangeRef = useRef(onDurationChange);

    useEffect(() => {
      onTimeUpdateRef.current = onTimeUpdate;
      onDurationChangeRef.current = onDurationChange;
    });

    const applySeek = useCallback(
      (player: YT.Player, seconds: number, play: boolean) => {
        player.seekTo(seconds, true);
        if (!play) {
          player.pauseVideo();
        } else {
          void player.playVideo();
        }
        window.setTimeout(() => {
          if (isYtPlayerReady(playerRef.current)) {
            onTimeUpdateRef.current?.(playerRef.current.getCurrentTime());
          }
        }, 80);
      },
      []
    );

    const seekTo = useCallback(
      (seconds: number, options?: { play?: boolean }) => {
        const play = options?.play !== false;
        const player = playerRef.current;
        if (!isYtPlayerReady(player) || !readyRef.current) {
          pendingSeekRef.current = { seconds, play };
          return;
        }
        applySeek(player, seconds, play);
      },
      [applySeek]
    );

    useImperativeHandle(
      ref,
      () => ({
        seekTo,
        play: () => {
          if (isYtPlayerReady(playerRef.current)) {
            void playerRef.current.playVideo();
          }
        },
        pause: () => {
          if (isYtPlayerReady(playerRef.current)) {
            playerRef.current.pauseVideo();
          }
        },
        getCurrentTime: () => {
          if (!isYtPlayerReady(playerRef.current)) return 0;
          return playerRef.current.getCurrentTime();
        },
        getDuration: () => {
          if (!isYtPlayerReady(playerRef.current)) return 0;
          return playerRef.current.getDuration() ?? 0;
        },
      }),
      [seekTo]
    );

    useEffect(() => {
      let cancelled = false;

      function clearTimers() {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        if (durationIntervalRef.current) {
          clearInterval(durationIntervalRef.current);
          durationIntervalRef.current = null;
        }
      }

      function teardownPlayer() {
        clearTimers();
        readyRef.current = false;
        try {
          playerRef.current?.destroy?.();
        } catch {
          // ignore
        }
        playerRef.current = null;
      }

      function reportDuration() {
        const player = playerRef.current;
        if (!isYtPlayerReady(player)) return;
        const d = player.getDuration();
        if (d > 0) onDurationChangeRef.current?.(d);
      }

      function initPlayer() {
        if (cancelled || !containerRef.current || !window.YT?.Player) return;

        teardownPlayer();

        const origin =
          typeof window !== "undefined" ? window.location.origin : undefined;

        const player = new window.YT.Player(containerRef.current, {
          videoId,
          width: "100%",
          height: "100%",
          playerVars: {
            autoplay: 0,
            rel: 0,
            modestbranding: 1,
            enablejsapi: 1,
            ...(origin ? { origin } : {}),
          },
          events: {
            onReady: (event: YT.PlayerEvent) => {
              if (cancelled) return;
              playerRef.current = event.target;
              readyRef.current = true;
              reportDuration();
              durationIntervalRef.current = setInterval(reportDuration, 2000);

              const pending = pendingSeekRef.current;
              if (pending && isYtPlayerReady(playerRef.current)) {
                pendingSeekRef.current = null;
                applySeek(playerRef.current, pending.seconds, pending.play);
              }
            },
            onStateChange: (event: YT.OnStateChangeEvent) => {
              if (event.data === window.YT.PlayerState.PLAYING) {
                if (intervalRef.current) clearInterval(intervalRef.current);
                intervalRef.current = setInterval(() => {
                  if (!isYtPlayerReady(playerRef.current)) return;
                  onTimeUpdateRef.current?.(playerRef.current.getCurrentTime());
                }, 250);
              } else if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
              }
            },
          },
        });

        playerRef.current = player;
      }

      void loadYouTubeIframeApi().then(() => {
        if (!cancelled) initPlayer();
      });

      return () => {
        cancelled = true;
        pendingSeekRef.current = null;
        teardownPlayer();
      };
    }, [videoId, applySeek]);

    return (
      <div
        className={
          fillContainer
            ? "relative w-full h-full overflow-hidden bg-black"
            : "relative w-full aspect-video rounded-xl overflow-hidden bg-black border border-[var(--color-card-border)]"
        }
      >
        <div ref={containerRef} className="absolute inset-0" />
      </div>
    );
  }
);
