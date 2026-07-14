"use client";

import { CaptionAppearancePanel } from "@/components/CaptionAppearancePanel";
import { CaptionTrackLayer } from "@/components/CaptionTrackLayer";
import { StreamPlayer, type StreamPlayerHandle } from "@/components/StreamPlayer";
import type { CaptionAppearance } from "@/lib/captionAppearance";
import type { CaptionEditsMap } from "@/lib/captionEdits";
import {
  transcriptHasWordTimings,
  type TranscriptChunkInput,
} from "@/lib/captionTrack";
import type { StreamEmbedInfo, StreamPlatform } from "@/lib/streamPlatform";
import { platformLabel } from "@/lib/streamPlatform";
import { cn } from "@/lib/cn";
import { useMemo, type RefObject } from "react";

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
  const hasWordTimings = useMemo(
    () => transcriptHasWordTimings(transcripts),
    [transcripts]
  );

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-[#050705]">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--color-card-border)] px-3 py-1.5">
        <p className="truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8f9b89]">
          Program
          <span className="ml-2 font-normal normal-case tracking-normal text-[#5f6b5c]">
            {platformLabel(platform)}
            {preferLocalVideo && playbackVideoUrl ? " · local" : ""}
          </span>
        </p>
        <div className="flex items-center gap-1.5">
          <CaptionAppearancePanel
            appearance={captionAppearance}
            onChange={onCaptionAppearanceChange}
            disabled={!captionsEnabled}
            hasWordTimings={hasWordTimings}
          />
          <button
            type="button"
            role="switch"
            aria-checked={captionsEnabled}
            onClick={() => onCaptionsEnabledChange(!captionsEnabled)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 border px-2 text-[10px] font-semibold transition-colors",
              captionsEnabled
                ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-black"
                : "border-[#21301f] bg-[#070a07] text-[var(--color-muted)] hover:border-[var(--color-accent)] hover:text-white"
            )}
            title="Toggle captions overlay and exports"
          >
            <span
              className={cn(
                "inline-flex h-4 w-4 items-center justify-center text-[9px] font-bold",
                captionsEnabled
                  ? "bg-black text-[var(--color-accent)]"
                  : "bg-[#142114] text-[#dfead8]"
              )}
            >
              CC
            </span>
            Captions
          </button>
        </div>
      </div>

      {/* Letterbox stage — video stays 16:9 inside the resizable pane */}
      <div
        className="relative min-h-0 flex-1 bg-[#020302]"
        style={{ containerType: "size" }}
      >
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            className="relative bg-black shadow-[0_0_0_1px_rgba(33,48,31,0.65)]"
            style={{
              aspectRatio: "16 / 9",
              width: "min(100%, calc(100cqh * 16 / 9))",
              height: "min(100%, calc(100cqw * 9 / 16))",
              maxWidth: "100%",
              maxHeight: "100%",
            }}
          >
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
      </div>
    </div>
  );
}
