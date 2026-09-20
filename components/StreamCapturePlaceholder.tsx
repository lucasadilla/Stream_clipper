"use client";

import { platformLabel, type StreamPlatform } from "@/lib/streamPlatform";
import { formatSeconds } from "@/lib/time";
import { PlatformBrandIcon } from "@/components/brand/PlatformBrandIcon";
import { OperationProgress } from "@/components/ui/operation-progress";

interface StreamCapturePlaceholderProps {
  platform: StreamPlatform;
  streamPageUrl?: string | null;
  channel?: string;
  recordedSeconds?: number;
}

export function StreamCapturePlaceholder({
  platform,
  streamPageUrl,
  channel,
  recordedSeconds = 0,
}: StreamCapturePlaceholderProps) {
  const label = platformLabel(platform);

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0a0a0a] px-6 text-center">
      <div className="relative">
        <PlatformBrandIcon brand={platform} size="lg" />
        <span className="absolute -inset-1 animate-pulse border border-[var(--color-accent)]/45" />
      </div>
      <div className="w-full max-w-md space-y-2">
        <OperationProgress
          compact
          title={recordedSeconds > 0 ? "Preparing playback" : "Starting local capture"}
          detail={
            recordedSeconds > 0
              ? `${formatSeconds(recordedSeconds)} captured and available for clipping`
              : `Connecting to ${label} and waiting for media…`
          }
          stages={
            recordedSeconds > 0
              ? []
              : [
                  `Connecting to ${label}…`,
                  "Waiting for the first media segment…",
                  "Building rewindable playback…",
                ]
          }
        />
        <p className="text-xs leading-relaxed text-[#888]">
          {platform === "twitch"
            ? "Twitch live embeds can't rewind — we're recording from the start so you can scrub the timeline. Preview appears here in a few seconds."
            : `Recording ${label} locally for clipping — preview appears here in a few seconds.`}
        </p>
      </div>
      {streamPageUrl && (
        <a
          href={streamPageUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs px-3 py-1.5 rounded-lg border border-[#444] text-[#ccc] hover:text-white hover:border-[#666]"
        >
          Watch live on {label}
          {channel ? ` (@${channel})` : ""}
        </a>
      )}
    </div>
  );
}
