"use client";

import { platformLabel, type StreamPlatform } from "@/lib/streamPlatform";
import { formatSeconds } from "@/lib/time";

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
      <div className="w-8 h-8 border-2 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin" />
      <div className="space-y-1 max-w-md">
        <p className="text-sm text-[#ddd] font-medium">
          {recordedSeconds > 0
            ? `Preparing playback (${formatSeconds(recordedSeconds)} captured)…`
            : `Starting local capture…`}
        </p>
        <p className="text-xs text-[#888] leading-relaxed">
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
