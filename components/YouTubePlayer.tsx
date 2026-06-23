"use client";

import {
  useEffect,
  useRef,
  useImperativeHandle,
  forwardRef,
  useCallback,
} from "react";

declare global {
  interface Window {
    YT: typeof YT;
    onYouTubeIframeAPIReady: () => void;
  }
}

export interface YouTubePlayerHandle {
  seekTo: (seconds: number) => void;
  play: () => void;
  pause: () => void;
  getCurrentTime: () => number;
}

interface YouTubePlayerProps {
  videoId: string;
  onTimeUpdate?: (time: number) => void;
}

export const YouTubePlayer = forwardRef<YouTubePlayerHandle, YouTubePlayerProps>(
  function YouTubePlayer({ videoId, onTimeUpdate }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const playerRef = useRef<YT.Player | null>(null);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const seekTo = useCallback((seconds: number) => {
      playerRef.current?.seekTo(seconds, true);
      playerRef.current?.playVideo();
    }, []);

    useImperativeHandle(ref, () => ({
      seekTo,
      play: () => playerRef.current?.playVideo(),
      pause: () => playerRef.current?.pauseVideo(),
      getCurrentTime: () => playerRef.current?.getCurrentTime() ?? 0,
    }));

    useEffect(() => {
      function initPlayer() {
        if (!containerRef.current || !window.YT?.Player) return;
        playerRef.current = new window.YT.Player(containerRef.current, {
          videoId,
          width: "100%",
          height: "100%",
          playerVars: {
            autoplay: 0,
            rel: 0,
            modestbranding: 1,
          },
          events: {
            onStateChange: (event: YT.OnStateChangeEvent) => {
              if (event.data === window.YT.PlayerState.PLAYING) {
                intervalRef.current = setInterval(() => {
                  const t = playerRef.current?.getCurrentTime() ?? 0;
                  onTimeUpdate?.(t);
                }, 500);
              } else if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
              }
            },
          },
        });
      }

      if (window.YT?.Player) {
        initPlayer();
      } else {
        const existing = document.querySelector('script[src*="youtube.com/iframe_api"]');
        if (!existing) {
          const tag = document.createElement("script");
          tag.src = "https://www.youtube.com/iframe_api";
          document.head.appendChild(tag);
        }
        window.onYouTubeIframeAPIReady = initPlayer;
      }

      return () => {
        if (intervalRef.current) clearInterval(intervalRef.current);
        playerRef.current?.destroy();
      };
    }, [videoId, onTimeUpdate]);

    return (
      <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-black border border-[var(--color-card-border)]">
        <div ref={containerRef} className="absolute inset-0" />
      </div>
    );
  }
);
