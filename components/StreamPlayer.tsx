"use client";

import { forwardRef, useEffect, useState } from "react";
import { YouTubePlayer } from "@/components/YouTubePlayer";
import { LocalVideoPlayer } from "@/components/LocalVideoPlayer";
import { KickEmbedPlayer } from "@/components/KickEmbedPlayer";
import { TwitchEmbedPlayer } from "@/components/TwitchEmbedPlayer";
import { StreamCapturePlaceholder } from "@/components/StreamCapturePlaceholder";
import type { StreamPlatform, StreamEmbedInfo } from "@/lib/streamPlatform";
import { resolveStreamEmbed } from "@/lib/streamPlatform";
import type { StreamPlayerHandle } from "@/types/streamPlayer";

interface StreamPlayerProps {
  platform: StreamPlatform;
  sourceId: string;
  embed: StreamEmbedInfo;
  playbackVideoUrl?: string | null;
  streamPageUrl?: string | null;
  recordedSeconds?: number;
  preferLocalVideo?: boolean;
  onTimeUpdate?: (time: number) => void;
  onDurationChange?: (duration: number) => void;
  fillContainer?: boolean;
}

export const StreamPlayer = forwardRef<StreamPlayerHandle, StreamPlayerProps>(
  function StreamPlayer(
    {
      platform,
      sourceId,
      embed,
      playbackVideoUrl,
      streamPageUrl,
      recordedSeconds = 0,
      preferLocalVideo = false,
      onTimeUpdate,
      onDurationChange,
      fillContainer,
    },
    ref
  ) {
    const [localFailed, setLocalFailed] = useState(false);

    useEffect(() => {
      setLocalFailed(false);
    }, [playbackVideoUrl, preferLocalVideo, platform, sourceId]);

    // YouTube always uses the embed so live + full VOD stay available.
    if (platform === "youtube") {
      return (
        <YouTubePlayer
          ref={ref}
          videoId={sourceId}
          onTimeUpdate={onTimeUpdate}
          onDurationChange={onDurationChange}
          fillContainer={fillContainer}
        />
      );
    }

    const resolvedEmbed = resolveStreamEmbed(platform, sourceId, embed);

    if (preferLocalVideo && playbackVideoUrl && !localFailed) {
      return (
        <LocalVideoPlayer
          ref={ref}
          src={playbackVideoUrl}
          onTimeUpdate={onTimeUpdate}
          onDurationChange={onDurationChange}
          onError={() => setLocalFailed(true)}
          fillContainer={fillContainer}
        />
      );
    }

    if (platform === "kick" && resolvedEmbed.kickChannel) {
      return (
        <KickEmbedPlayer
          ref={ref}
          channel={resolvedEmbed.kickChannel}
          onTimeUpdate={onTimeUpdate}
          onDurationChange={onDurationChange}
          fillContainer={fillContainer}
        />
      );
    }

    if (platform === "twitch") {
      return (
        <TwitchEmbedPlayer
          ref={ref}
          channel={resolvedEmbed.twitchChannel}
          videoId={
            resolvedEmbed.twitchChannel
              ? undefined
              : resolvedEmbed.twitchVideoId
          }
          onTimeUpdate={onTimeUpdate}
          onDurationChange={onDurationChange}
          fillContainer={fillContainer}
        />
      );
    }

    return (
      <StreamCapturePlaceholder
        platform={platform}
        streamPageUrl={streamPageUrl}
        channel={resolvedEmbed.kickChannel ?? resolvedEmbed.twitchChannel}
        recordedSeconds={recordedSeconds}
      />
    );
  }
);

export type { StreamPlayerHandle };
