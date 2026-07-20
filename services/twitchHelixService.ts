import type { ParsedStreamUrl } from "@/lib/streamPlatform";
import type { YtDlpStreamMetadata } from "@/services/ytDlpMetadataService";
import { withStreamEmbed } from "@/services/ytDlpMetadataService";
import { sanitizeStreamStartDate } from "@/lib/timelineBounds";

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getTwitchAppToken(): Promise<string | null> {
  const clientId = process.env.TWITCH_CLIENT_ID?.trim();
  const clientSecret = process.env.TWITCH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;

  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "client_credentials",
  });

  const res = await fetch(`https://id.twitch.tv/oauth2/token?${params.toString()}`, {
    method: "POST",
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

async function helixGet<T>(
  path: string,
  searchParams: Record<string, string>
): Promise<T | null> {
  const clientId = process.env.TWITCH_CLIENT_ID?.trim();
  const token = await getTwitchAppToken();
  if (!clientId || !token) return null;

  const params = new URLSearchParams(searchParams);
  const res = await fetch(`https://api.twitch.tv/helix/${path}?${params}`, {
    headers: {
      "Client-ID": clientId,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

export async function fetchTwitchHelixMetadata(
  parsed: ParsedStreamUrl
): Promise<YtDlpStreamMetadata | null> {
  const channel = parsed.embed.twitchChannel;
  const videoId = parsed.embed.twitchVideoId;

  if (videoId) {
    const data = await helixGet<{
      data?: Array<{
        id: string;
        title?: string;
        description?: string;
        thumbnail_url?: string;
        user_name?: string;
        user_id?: string;
        duration?: string;
        view_count?: number;
      }>;
    }>("videos", { id: videoId });

    const item = data?.data?.[0];
    if (!item) return null;

    return {
      sourceId: item.id,
      title: item.title ?? "Twitch VOD",
      description: item.description ?? "",
      channelTitle: item.user_name ?? "",
      channelId: item.user_id ?? "",
      thumbnailUrl: item.thumbnail_url?.replace("%{width}", "1280").replace("%{height}", "720") ?? "",
      liveStatus: "completed",
      actualStartTime: null,
      scheduledStartTime: null,
      concurrentViewers: item.view_count ?? null,
      durationSeconds: null,
      raw: withStreamEmbed(item as unknown as Record<string, unknown>, parsed.embed),
    };
  }

  if (!channel) return null;

  const data = await helixGet<{
    data?: Array<{
      id: string;
      user_name?: string;
      user_id?: string;
      title?: string;
      started_at?: string;
      viewer_count?: number;
      thumbnail_url?: string;
    }>;
  }>("streams", { user_login: channel });

  const live = data?.data?.[0];
  if (live) {
    return {
      // Channel login — not Helix user_id. Numeric ids get misread as VOD ids
      // by the Twitch embed and blank the program monitor.
      sourceId: channel,
      title: live.title ?? `${live.user_name ?? channel} (live)`,
      description: "",
      channelTitle: live.user_name ?? channel,
      channelId: live.user_id ?? "",
      thumbnailUrl:
        live.thumbnail_url?.replace("{width}", "1280").replace("{height}", "720") ??
        twitchPreviewUrl(channel),
      liveStatus: "live",
      actualStartTime: live.started_at
        ? sanitizeStreamStartDate(new Date(live.started_at))
        : null,
      scheduledStartTime: null,
      concurrentViewers: live.viewer_count ?? null,
      durationSeconds: null,
      raw: withStreamEmbed(live as unknown as Record<string, unknown>, parsed.embed),
    };
  }

  const users = await helixGet<{
    data?: Array<{ id: string; display_name?: string; login?: string }>;
  }>("users", { login: channel });

  const user = users?.data?.[0];
  if (!user) return null;

  return {
    sourceId: (user.login ?? channel).toLowerCase(),
    title: `${user.display_name ?? channel} (Twitch)`,
    description: "",
    channelTitle: user.display_name ?? channel,
    channelId: user.id,
    thumbnailUrl: twitchPreviewUrl(channel),
    liveStatus: "none",
    actualStartTime: null,
    scheduledStartTime: null,
    concurrentViewers: null,
    durationSeconds: null,
    raw: withStreamEmbed(user as unknown as Record<string, unknown>, parsed.embed),
  };
}

export function twitchPreviewUrl(channel: string): string {
  return `https://static-cdn.jtvnw.net/previews-ttv/live_user_${channel.toLowerCase()}-1280x720.jpg`;
}

export function fallbackTwitchMetadata(
  parsed: ParsedStreamUrl
): YtDlpStreamMetadata {
  const channel = parsed.embed.twitchChannel ?? parsed.sourceId;
  const isVod = !!parsed.embed.twitchVideoId;

  return {
    sourceId: parsed.sourceId,
    title: isVod ? `Twitch VOD ${parsed.sourceId}` : `${channel} (Twitch)`,
    description: "",
    channelTitle: channel,
    channelId: "",
    thumbnailUrl: isVod ? "" : twitchPreviewUrl(channel),
    liveStatus: isVod ? "completed" : "live",
    actualStartTime: null,
    scheduledStartTime: null,
    concurrentViewers: null,
    durationSeconds: null,
    raw: withStreamEmbed({ fallback: true }, parsed.embed),
  };
}

export function fallbackKickMetadata(parsed: ParsedStreamUrl): YtDlpStreamMetadata {
  const channel = parsed.embed.kickChannel ?? parsed.sourceId;
  const isVod = parsed.canonicalUrl.includes("/videos/");

  return {
    sourceId: parsed.sourceId,
    title: isVod ? `Kick VOD` : `${channel} (Kick)`,
    description: "",
    channelTitle: channel,
    channelId: "",
    thumbnailUrl: "",
    liveStatus: isVod ? "completed" : "live",
    actualStartTime: null,
    scheduledStartTime: null,
    concurrentViewers: null,
    durationSeconds: null,
    raw: withStreamEmbed({ fallback: true }, parsed.embed),
  };
}
