import {
  baseYtDlpArgs,
  isTransientYtDlpError,
  isYtDlpAvailable,
  runYtDlp,
} from "@/services/youtubeDownloadService";
import type { ParsedStreamUrl, StreamEmbedInfo } from "@/lib/streamPlatform";
import { sanitizeUnixTimestampSeconds } from "@/lib/timelineBounds";
import {
  fallbackKickMetadata,
  fallbackTwitchMetadata,
  fetchTwitchHelixMetadata,
} from "@/services/twitchHelixService";

export interface YtDlpStreamMetadata {
  sourceId: string;
  title: string;
  description: string;
  channelTitle: string;
  channelId: string;
  thumbnailUrl: string;
  liveStatus: string | null;
  actualStartTime: Date | null;
  scheduledStartTime: Date | null;
  concurrentViewers: number | null;
  durationSeconds: number | null;
  raw: Record<string, unknown>;
}

interface YtDlpJson {
  id?: string;
  title?: string;
  description?: string;
  thumbnail?: string;
  uploader?: string;
  uploader_id?: string;
  channel?: string;
  channel_id?: string;
  channel_url?: string;
  is_live?: boolean;
  live_status?: string;
  duration?: number;
  release_timestamp?: number;
  timestamp?: number;
  view_count?: number;
}

function mapYtDlpLiveStatus(data: YtDlpJson): string | null {
  if (data.is_live) return "live";
  if (data.live_status === "is_upcoming") return "upcoming";
  if (data.live_status === "was_live" || data.live_status === "post_live") {
    return "post_live";
  }
  if (data.duration && data.duration > 0) return "completed";
  return "none";
}

function resolveStartTime(data: YtDlpJson): Date | null {
  if (typeof data.release_timestamp === "number" && data.release_timestamp > 0) {
    return sanitizeUnixTimestampSeconds(data.release_timestamp);
  }
  // `timestamp` is often upload/VOD metadata — skip for live stream start.
  if (!data.is_live && typeof data.timestamp === "number" && data.timestamp > 0) {
    return sanitizeUnixTimestampSeconds(data.timestamp);
  }
  return null;
}

function mapYtDlpJson(
  data: YtDlpJson,
  fallbackSourceId: string,
  embed: StreamEmbedInfo
): YtDlpStreamMetadata {
  const duration =
    typeof data.duration === "number" && data.duration > 0
      ? data.duration
      : null;

  return {
    sourceId: data.id ?? fallbackSourceId,
    title: data.title ?? "Untitled stream",
    description: data.description ?? "",
    channelTitle: data.uploader ?? data.channel ?? "",
    channelId: data.uploader_id ?? data.channel_id ?? "",
    thumbnailUrl: data.thumbnail ?? "",
    liveStatus: mapYtDlpLiveStatus(data),
    actualStartTime: resolveStartTime(data),
    scheduledStartTime: null,
    concurrentViewers:
      typeof data.view_count === "number" ? data.view_count : null,
    durationSeconds: duration,
    raw: withStreamEmbed(data as unknown as Record<string, unknown>, embed),
  };
}

function parseYtDlpOutput(stdout: string, stderr: string): YtDlpJson {
  const text = stdout.trim() || stderr.trim();
  if (!text) {
    throw new Error("yt-dlp returned no metadata for this URL");
  }

  const jsonStart = text.indexOf("{");
  if (jsonStart < 0) {
    throw new Error("yt-dlp returned invalid metadata for this URL");
  }

  try {
    return JSON.parse(text.slice(jsonStart)) as YtDlpJson;
  } catch {
    throw new Error("yt-dlp returned invalid metadata for this URL");
  }
}

export async function fetchYtDlpMetadata(
  url: string,
  fallbackSourceId: string,
  embed: StreamEmbedInfo = {}
): Promise<YtDlpStreamMetadata> {
  const available = await isYtDlpAvailable();
  if (!available) {
    throw new Error(
      "yt-dlp is not installed. Install it from https://github.com/yt-dlp/yt-dlp and set YT_DLP_PATH in .env."
    );
  }

  const { stdout, stderr } = await runYtDlp(
    [
      ...baseYtDlpArgs({ url }),
      "--dump-single-json",
      "--skip-download",
    ],
    url
  );

  return mapYtDlpJson(parseYtDlpOutput(stdout, stderr), fallbackSourceId, embed);
}

/** Lightweight live/upcoming check — used before choosing VOD vs live capture. */
export async function probeYtDlpLiveStatus(
  url: string
): Promise<"live" | "upcoming" | "post_live" | "completed" | "none" | null> {
  const available = await isYtDlpAvailable();
  if (!available) return null;

  const { stdout, stderr } = await runYtDlp(
    [
      ...baseYtDlpArgs({ url }),
      "--dump-single-json",
      "--skip-download",
      "--no-warnings",
    ],
    url,
    { retries: 1 }
  );
  const data = parseYtDlpOutput(stdout, stderr);
  return mapYtDlpLiveStatus(data) as
    | "live"
    | "upcoming"
    | "post_live"
    | "completed"
    | "none"
    | null;
}

export async function fetchStreamPlatformMetadata(
  parsed: ParsedStreamUrl
): Promise<YtDlpStreamMetadata> {
  try {
    return await fetchYtDlpMetadata(
      parsed.canonicalUrl,
      parsed.sourceId,
      parsed.embed
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    if (parsed.platform === "twitch") {
      const helix = await fetchTwitchHelixMetadata(parsed);
      if (helix) return helix;

      if (isTransientYtDlpError(message)) {
        return fallbackTwitchMetadata(parsed);
      }
    }

    if (parsed.platform === "kick" && isTransientYtDlpError(message)) {
      return fallbackKickMetadata(parsed);
    }

    if (isTransientYtDlpError(message)) {
      throw new Error(
        `${message}\n\nTwitch/Kick metadata could not be fetched (DNS/network). Try: flush DNS (ipconfig /flushdns), switch DNS to 1.1.1.1, or add TWITCH_CLIENT_ID + TWITCH_CLIENT_SECRET to .env for Helix fallback.`
      );
    }

    throw err;
  }
}

export function withStreamEmbed(
  raw: Record<string, unknown>,
  embed: StreamEmbedInfo
): Record<string, unknown> {
  return { ...raw, streamEmbed: embed };
}
