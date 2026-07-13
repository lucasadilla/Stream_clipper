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
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-2.5">
      <div className="flex items-center justify-between gap-3 px-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
          {platformLabel(platform)} preview
          {preferLocalVideo && playbackVideoUrl ? " / local capture" : ""}
        </p>
        <div className="flex items-center gap-2">
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
              "inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors",
              captionsEnabled
                ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-black shadow-[0_0_18px_rgba(149,255,0,0.18)]"
                : "border-[#21301f] bg-[#070a07] text-[var(--color-muted)] hover:border-[var(--color-accent)] hover:text-white"
            )}
            title="Toggle captions overlay and exports"
          >
            <span
              className={cn(
                "inline-flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold",
                captionsEnabled
                  ? "bg-black text-[var(--color-accent)]"
                  : "bg-[#142114] text-[#dfead8]"
              )}
            >
              CC
            </span>
            Captions {captionsEnabled ? "on" : "off"}
          </button>
        </div>
      </div>

      <div className="relative isolate h-[min(42vh,520px)] min-h-[220px] w-full overflow-hidden rounded-lg border border-[var(--color-card-border)] bg-black shadow-[0_20px_80px_rgba(0,0,0,0.42)]">
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
