"use client";

import { StreamPlayer, type StreamPlayerHandle } from "@/components/StreamPlayer";
import { CaptionTrackLayer } from "@/components/CaptionTrackLayer";
import { CaptionAppearancePanel } from "@/components/CaptionAppearancePanel";
import type { TranscriptChunkInput } from "@/lib/captionTrack";
import type { CaptionAppearance } from "@/lib/captionAppearance";
import type { CaptionEditsMap } from "@/lib/captionEdits";
import type { StreamPlatform, StreamEmbedInfo } from "@/lib/streamPlatform";
import { platformLabel } from "@/lib/streamPlatform";
import { cn } from "@/lib/utils";
import type { RefObject } from "react";

interface VideoPreviewProps {
  platform: StreamPlatform;
  sourceId: string;
  embed: StreamEmbedInfo;
  playbackVideoUrl?: string | null;
  streamPageUrl?: string | null;
  recordedSeconds?: number;
  preferLocalVideo?: boolean;
  playerRef: RefObject<StreamPlayerHandle | null>;
  transcripts: TranscriptChunkInput[];
  captionsEnabled: boolean;
  captionEdits?: CaptionEditsMap;
  captionAppearance: CaptionAppearance;
  onCaptionsEnabledChange: (enabled: boolean) => void;
  onCaptionAppearanceChange: (appearance: CaptionAppearance) => void;
  onTimeUpdate: (time: number) => void;
  onDurationChange: (duration: number) => void;
}

export function VideoPreview({
  platform,
  sourceId,
  embed,
  playbackVideoUrl,
  streamPageUrl,
  recordedSeconds = 0,
  preferLocalVideo,
  playerRef,
  transcripts,
  captionsEnabled,
  captionEdits = {},
  captionAppearance,
  onCaptionsEnabledChange,
  onCaptionAppearanceChange,
  onTimeUpdate,
  onDurationChange,
}: VideoPreviewProps) {
  return (
    <div className="w-full max-w-6xl mx-auto flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3 px-1">
        <p className="text-xs text-[#888]">
          {platformLabel(platform)} preview
          {preferLocalVideo && playbackVideoUrl ? " · local capture" : ""}
        </p>
        <div className="flex items-center gap-2">
          <CaptionAppearancePanel
            appearance={captionAppearance}
            onChange={onCaptionAppearanceChange}
            disabled={!captionsEnabled}
          />
          <button
            type="button"
            role="switch"
            aria-checked={captionsEnabled}
            onClick={() => onCaptionsEnabledChange(!captionsEnabled)}
            className={cn(
              "inline-flex items-center gap-2 text-xs font-medium rounded-full px-3 py-1.5 border transition-colors",
              captionsEnabled
                ? "border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-[var(--color-accent)]"
                : "border-[#444] bg-[#1a1a1a] text-[#aaa] hover:border-[#666]"
            )}
            title="Toggle captions overlay and exports"
          >
            <span
              className={cn(
                "inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold",
                captionsEnabled
                  ? "bg-[var(--color-accent)] text-white"
                  : "bg-[#333] text-[#ccc]"
              )}
            >
              CC
            </span>
            Captions {captionsEnabled ? "on" : "off"}
          </button>
        </div>
      </div>

      <div className="relative isolate w-full h-[min(42vh,520px)] min-h-[220px] overflow-hidden rounded-xl border border-[#2a2a2a] bg-black">
        <div className="absolute inset-0 z-0">
          <StreamPlayer
            ref={playerRef}
            platform={platform}
            sourceId={sourceId}
            embed={embed}
            playbackVideoUrl={playbackVideoUrl}
            streamPageUrl={streamPageUrl}
            recordedSeconds={recordedSeconds}
            preferLocalVideo={preferLocalVideo}
            onTimeUpdate={onTimeUpdate}
            onDurationChange={onDurationChange}
            fillContainer
          />
        </div>
        <CaptionTrackLayer
          enabled={captionsEnabled}
          playerRef={playerRef}
          chunks={transcripts}
          captionEdits={captionEdits}
          appearance={captionAppearance}
          showVerticalSafeArea={captionsEnabled}
        />
      </div>
    </div>
  );
}
