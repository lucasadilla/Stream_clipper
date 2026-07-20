import {
  extractYouTubeVideoId,
  normalizeYouTubeUrl,
  normalizeUserYoutubeUrl,
} from "@/lib/youtube";

export type StreamPlatform = "youtube" | "twitch" | "kick";

export interface StreamEmbedInfo {
  twitchChannel?: string;
  twitchVideoId?: string;
  kickChannel?: string;
}

export interface ParsedStreamUrl {
  platform: StreamPlatform;
  /** Video id (YouTube/Twitch VOD) or channel login (live Twitch/Kick). */
  sourceId: string;
  canonicalUrl: string;
  embed: StreamEmbedInfo;
}

const TWITCH_RESERVED = new Set([
  "videos",
  "directory",
  "clips",
  "p",
  "settings",
  "downloads",
  "search",
  "turbo",
  "prime",
]);

export function normalizeUserStreamUrl(input: string): string {
  return normalizeUserYoutubeUrl(input);
}

export function parseStreamUrl(input: string): ParsedStreamUrl | null {
  const url = normalizeUserStreamUrl(input);
  if (!url) return null;

  const youtubeId = extractYouTubeVideoId(url);
  if (youtubeId) {
    return {
      platform: "youtube",
      sourceId: youtubeId,
      canonicalUrl: normalizeYouTubeUrl(youtubeId),
      embed: {},
    };
  }

  const twitchVideo = url.match(/twitch\.tv\/videos\/(\d+)/i);
  if (twitchVideo?.[1]) {
    const videoId = twitchVideo[1];
    return {
      platform: "twitch",
      sourceId: videoId,
      canonicalUrl: `https://www.twitch.tv/videos/${videoId}`,
      embed: { twitchVideoId: videoId },
    };
  }

  const twitchChannel = url.match(/twitch\.tv\/([a-zA-Z0-9_]{2,25})(?:[/?#]|$)/i);
  if (
    twitchChannel?.[1] &&
    !TWITCH_RESERVED.has(twitchChannel[1].toLowerCase())
  ) {
    const channel = twitchChannel[1].toLowerCase();
    return {
      platform: "twitch",
      sourceId: channel,
      canonicalUrl: `https://www.twitch.tv/${channel}`,
      embed: { twitchChannel: channel },
    };
  }

  const kickVideo = url.match(/kick\.com\/([^/]+)\/videos\/([a-f0-9-]+)/i);
  if (kickVideo?.[1] && kickVideo?.[2]) {
    const channel = kickVideo[1].toLowerCase();
    return {
      platform: "kick",
      sourceId: kickVideo[2],
      canonicalUrl: `https://kick.com/${channel}/videos/${kickVideo[2]}`,
      embed: { kickChannel: channel },
    };
  }

  const kickChannel = url.match(/kick\.com\/([a-zA-Z0-9_-]{2,30})(?:[/?#]|$)/i);
  if (kickChannel?.[1]) {
    const channel = kickChannel[1].toLowerCase();
    const reserved = new Set(["terms", "privacy", "dmca", "community-guidelines"]);
    if (!reserved.has(channel)) {
      return {
        platform: "kick",
        sourceId: channel,
        canonicalUrl: `https://kick.com/${channel}`,
        embed: { kickChannel: channel },
      };
    }
  }

  return null;
}

export function platformLabel(platform: StreamPlatform): string {
  if (platform === "twitch") return "Twitch";
  if (platform === "kick") return "Kick";
  return "YouTube";
}

export function readStreamEmbed(metadataJson: unknown): StreamEmbedInfo {
  if (!metadataJson || typeof metadataJson !== "object") return {};
  const embed = (metadataJson as { streamEmbed?: StreamEmbedInfo }).streamEmbed;
  return embed ?? {};
}

export function isLiveStatus(liveStatus: string | null | undefined): boolean {
  return liveStatus === "live" || liveStatus === "upcoming";
}

/** Browsers reliably play these in <video>; live captures are usually .mkv. */
export function isBrowserPlayableVideoUrl(
  url: string | null | undefined
): boolean {
  if (!url) return false;
  return /\.(mp4|webm|m4v)(\?|#|$)/i.test(url);
}

/** Fill missing Twitch/Kick channel or VOD id from session sourceId. */
export function resolveStreamEmbed(
  platform: StreamPlatform,
  sourceId: string,
  embed: StreamEmbedInfo
): StreamEmbedInfo {
  if (platform === "twitch") {
    const twitchChannel =
      embed.twitchChannel?.trim().toLowerCase() ||
      (!/^\d+$/.test(sourceId) ? sourceId.toLowerCase() : undefined);

    // Prefer an explicit VOD id from the URL/embed. Never invent a video id from
    // a numeric Helix user_id / stream id when we already know the channel —
    // that makes the Twitch embed request a non-existent VOD and stay blank
    // while live capture + transcription still work.
    const twitchVideoId =
      embed.twitchVideoId?.trim() ||
      (!twitchChannel && /^\d+$/.test(sourceId) ? sourceId : undefined);

    return { twitchChannel, twitchVideoId };
  }
  if (platform === "kick") {
    return {
      kickChannel: embed.kickChannel ?? sourceId.toLowerCase(),
    };
  }
  return embed;
}

export function shouldPreferLocalVideoPreview(options: {
  platform: StreamPlatform;
  previewVideoUrl?: string | null;
  sourceVideoUrl?: string | null;
  sourceIsPlayableMp4?: boolean;
  isLiveRecording?: boolean;
  isLive?: boolean;
  durationSeconds?: number | null;
  /** Known full stream length (metadata). Local is preferred only once capture catches up. */
  knownStreamDuration?: number | null;
}): boolean {
  // YouTube embed is the live + full-VOD player. Local capture is for clipping,
  // not for replacing the stream viewer.
  if (options.platform === "youtube") return false;

  // Twitch/Kick live: same rule — keep the channel embed so the monitor shows
  // the ongoing stream. Local remux is only what we've captured so far (often
  // much shorter than a multi-hour live), and locking onto it makes the player
  // look like a finite VOD (e.g. 30 min of a 3 hour stream).
  if (
    (options.platform === "twitch" || options.platform === "kick") &&
    options.isLive
  ) {
    return false;
  }

  const playbackUrl =
    options.previewVideoUrl ??
    (options.sourceIsPlayableMp4 ? options.sourceVideoUrl : null);

  // Never prefer local without a playable file (avoids black placeholder).
  if (!isBrowserPlayableVideoUrl(playbackUrl)) return false;

  const localSeconds = options.durationSeconds ?? 0;
  if (localSeconds < 2) return false;

  const known = options.knownStreamDuration ?? 0;
  // Keep using the remote player until local media covers most of the stream,
  // so the full timeline stays scrubbable before download/render finishes.
  if (known > 30 && localSeconds < known * 0.9) {
    return false;
  }

  return true;
}
