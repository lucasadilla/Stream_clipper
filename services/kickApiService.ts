import type { ParsedStreamUrl, StreamEmbedInfo } from "@/lib/streamPlatform";
import type { YtDlpStreamMetadata } from "@/services/ytDlpMetadataService";
import { sanitizeStreamStartDate } from "@/lib/timelineBounds";

function withStreamEmbed(
  raw: Record<string, unknown>,
  embed: StreamEmbedInfo
): Record<string, unknown> {
  return { ...raw, streamEmbed: embed };
}

const KICK_TOKEN_URL = "https://id.kick.com/oauth/token";
const KICK_API = "https://api.kick.com";

let cachedToken: { value: string; expiresAt: number } | null = null;

function kickClientCredentials(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.AUTH_KICK_ID?.trim();
  const clientSecret = process.env.AUTH_KICK_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

async function getKickAppToken(): Promise<string | null> {
  const creds = kickClientCredentials();
  if (!creds) return null;

  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
  });

  const res = await fetch(KICK_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) return null;

  const data = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!data.access_token) return null;

  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return data.access_token;
}

async function kickPublicGet<T>(
  path: string,
  searchParams: Record<string, string>
): Promise<T | null> {
  const token = await getKickAppToken();
  if (!token) return null;

  const params = new URLSearchParams(searchParams);
  const res = await fetch(`${KICK_API}${path}?${params}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

interface KickChannelRow {
  broadcaster_user_id?: number;
  slug?: string;
  stream_title?: string;
  banner_picture?: string;
  stream?: {
    is_live?: boolean;
    start_time?: string;
    thumbnail?: string;
    viewer_count?: number;
    url?: string;
  };
}

interface KickLivestreamRow {
  id?: string;
  title?: string;
  started_at?: string;
  thumbnail?: string;
  viewer_count?: number;
  broadcaster_user?: {
    id?: number;
    username?: string;
    profile_picture?: string;
  };
  channel?: { slug?: string };
}

function isKickVideoUuid(value: string | null | undefined): boolean {
  return Boolean(
    value &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        value
      )
  );
}

/**
 * Resolve Kick channel metadata via the official Public API.
 * Live streams expose a UUID on /users/livestreams — that UUID is the
 * ongoing VOD id yt-dlp can download from stream start (kick:vod).
 */
export async function fetchKickApiMetadata(
  parsed: ParsedStreamUrl
): Promise<YtDlpStreamMetadata | null> {
  if (parsed.platform !== "kick") return null;

  const channel =
    parsed.embed.kickChannel?.trim().toLowerCase() ||
    (!isKickVideoUuid(parsed.sourceId) ? parsed.sourceId.toLowerCase() : null);
  const knownVideoId =
    parsed.embed.kickVideoId?.trim() ||
    (isKickVideoUuid(parsed.sourceId) ? parsed.sourceId : null);

  // Direct VOD URL — still prefer API for live/start when we know the channel.
  if (knownVideoId && !channel) {
    return {
      sourceId: knownVideoId,
      title: "Kick VOD",
      description: "",
      channelTitle: "",
      channelId: "",
      thumbnailUrl: "",
      liveStatus: "completed",
      actualStartTime: null,
      scheduledStartTime: null,
      concurrentViewers: null,
      durationSeconds: null,
      raw: withStreamEmbed(
        { kickVideoId: knownVideoId },
        { kickVideoId: knownVideoId }
      ),
    };
  }

  if (!channel) return null;

  const channels = await kickPublicGet<{ data?: KickChannelRow[] }>(
    "/public/v1/channels",
    { slug: channel }
  );
  const row = channels?.data?.[0];
  if (!row) return null;

  const stream = row.stream;
  const isLive = Boolean(stream?.is_live);
  const broadcasterId = row.broadcaster_user_id;
  let kickVideoId = knownVideoId ?? undefined;
  let livestream: KickLivestreamRow | undefined;

  if (isLive && broadcasterId != null) {
    const lives = await kickPublicGet<{ data?: KickLivestreamRow[] }>(
      "/public/v1/users/livestreams",
      { user_id: String(broadcasterId) }
    );
    livestream = lives?.data?.find(
      (item) =>
        item.channel?.slug?.toLowerCase() === channel ||
        item.broadcaster_user?.id === broadcasterId
    );
    if (!livestream && lives?.data?.length === 1) {
      livestream = lives.data[0];
    }
    if (isKickVideoUuid(livestream?.id)) {
      kickVideoId = livestream!.id;
    }
  }

  const embed: StreamEmbedInfo = {
    kickChannel: channel,
    ...(kickVideoId ? { kickVideoId } : {}),
  };

  const title =
    livestream?.title ??
    row.stream_title ??
    (isLive ? `${channel} (live)` : `${channel} (Kick)`);

  const startRaw = livestream?.started_at ?? stream?.start_time ?? null;
  const actualStartTime = startRaw
    ? sanitizeStreamStartDate(new Date(startRaw))
    : null;

  return {
    // Keep channel slug as sourceId while live so embeds stay on the channel.
    sourceId: isLive ? channel : (kickVideoId ?? channel),
    title,
    description: "",
    channelTitle: livestream?.broadcaster_user?.username ?? channel,
    channelId: broadcasterId != null ? String(broadcasterId) : "",
    thumbnailUrl:
      livestream?.thumbnail ?? stream?.thumbnail ?? row.banner_picture ?? "",
    liveStatus: isLive ? "live" : kickVideoId ? "completed" : "none",
    actualStartTime,
    scheduledStartTime: null,
    concurrentViewers:
      livestream?.viewer_count ?? stream?.viewer_count ?? null,
    durationSeconds: null,
    raw: withStreamEmbed(
      {
        kickApi: true,
        broadcaster_user_id: broadcasterId,
        kickVideoId: kickVideoId ?? null,
        stream,
        livestream,
      },
      embed
    ),
  };
}

export function fallbackKickMetadata(
  parsed: ParsedStreamUrl
): YtDlpStreamMetadata {
  const channel = parsed.embed.kickChannel ?? parsed.sourceId;
  const kickVideoId =
    parsed.embed.kickVideoId ??
    (isKickVideoUuid(parsed.sourceId) ? parsed.sourceId : undefined);
  const isVod = Boolean(kickVideoId) || parsed.canonicalUrl.includes("/videos/");

  return {
    sourceId: kickVideoId ?? parsed.sourceId,
    title: isVod ? "Kick VOD" : `${channel} (Kick)`,
    description: "",
    channelTitle: typeof channel === "string" ? channel : "",
    channelId: "",
    thumbnailUrl: "",
    // Channel URLs: don't assume live — acquireSourceMedia probes when needed.
    liveStatus: isVod ? "completed" : "none",
    actualStartTime: null,
    scheduledStartTime: null,
    concurrentViewers: null,
    durationSeconds: null,
    raw: withStreamEmbed(
      { fallback: true },
      {
        kickChannel:
          parsed.embed.kickChannel ??
          (!isKickVideoUuid(String(channel)) ? String(channel) : undefined),
        ...(kickVideoId ? { kickVideoId } : {}),
      }
    ),
  };
}

export function buildKickVodCaptureUrl(
  channel: string,
  videoId: string
): string {
  return `https://kick.com/${channel.toLowerCase()}/videos/${videoId}`;
}
