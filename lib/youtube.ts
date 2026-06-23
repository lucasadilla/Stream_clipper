const YOUTUBE_PATTERNS = [
  /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
  /(?:youtube\.com\/live\/)([a-zA-Z0-9_-]{11})/,
  /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
  /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
  /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
];

export interface ParsedYouTubeUrl {
  videoId: string;
  originalUrl: string;
}

export function extractYouTubeVideoId(url: string): string | null {
  const trimmed = url.trim();
  for (const pattern of YOUTUBE_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

export function parseYouTubeUrl(url: string): ParsedYouTubeUrl {
  const videoId = extractYouTubeVideoId(url);
  if (!videoId) {
    throw new Error(
      "Invalid YouTube URL. Supported formats: youtube.com/watch?v=, youtu.be/, youtube.com/live/"
    );
  }
  return { videoId, originalUrl: url.trim() };
}

export function normalizeYouTubeUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export interface YouTubeVideoMetadata {
  videoId: string;
  title: string;
  description: string;
  channelTitle: string;
  channelId: string;
  thumbnailUrl: string;
  liveStatus: string | null;
  actualStartTime: Date | null;
  scheduledStartTime: Date | null;
  concurrentViewers: number | null;
  activeLiveChatId: string | null;
  raw: Record<string, unknown>;
}

export async function fetchYouTubeMetadata(
  videoId: string
): Promise<YouTubeVideoMetadata> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    throw new Error("YOUTUBE_API_KEY is not configured");
  }

  const params = new URLSearchParams({
    part: "snippet,liveStreamingDetails,statistics",
    id: videoId,
    key: apiKey,
  });

  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?${params.toString()}`
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`YouTube API error: ${res.status} ${text}`);
  }

  const data = (await res.json()) as {
    items?: Array<{
      id: string;
      snippet?: {
        title?: string;
        description?: string;
        channelTitle?: string;
        channelId?: string;
        thumbnails?: { high?: { url?: string }; medium?: { url?: string } };
        liveBroadcastContent?: string;
      };
      liveStreamingDetails?: {
        actualStartTime?: string;
        scheduledStartTime?: string;
        concurrentViewers?: string;
        activeLiveChatId?: string;
      };
    }>;
  };

  const item = data.items?.[0];
  if (!item) {
    throw new Error("Video not found on YouTube");
  }

  const snippet = item.snippet ?? {};
  const live = item.liveStreamingDetails ?? {};
  const thumb =
    snippet.thumbnails?.high?.url ?? snippet.thumbnails?.medium?.url ?? "";

  return {
    videoId: item.id,
    title: snippet.title ?? "Untitled",
    description: snippet.description ?? "",
    channelTitle: snippet.channelTitle ?? "",
    channelId: snippet.channelId ?? "",
    thumbnailUrl: thumb,
    liveStatus: snippet.liveBroadcastContent ?? null,
    actualStartTime: live.actualStartTime
      ? new Date(live.actualStartTime)
      : null,
    scheduledStartTime: live.scheduledStartTime
      ? new Date(live.scheduledStartTime)
      : null,
    concurrentViewers: live.concurrentViewers
      ? parseInt(live.concurrentViewers, 10)
      : null,
    activeLiveChatId: live.activeLiveChatId ?? null,
    raw: item as unknown as Record<string, unknown>,
  };
}

export interface LiveChatMessage {
  id: string;
  authorName: string;
  authorChannelId: string | null;
  messageText: string;
  publishedAt: Date;
  raw: Record<string, unknown>;
}

export interface LiveChatPollResult {
  messages: LiveChatMessage[];
  nextPageToken: string | null;
  pollingIntervalMillis: number;
  offlineAt: Date | null;
}

export async function fetchLiveChatMessages(
  liveChatId: string,
  pageToken?: string | null
): Promise<LiveChatPollResult> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    throw new Error("YOUTUBE_API_KEY is not configured");
  }

  const params = new URLSearchParams({
    part: "snippet,authorDetails",
    liveChatId,
    key: apiKey,
    maxResults: "200",
  });
  if (pageToken) params.set("pageToken", pageToken);

  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/liveChat/messages?${params.toString()}`
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`YouTube Live Chat API error: ${res.status} ${text}`);
  }

  const data = (await res.json()) as {
    items?: Array<{
      id: string;
      snippet?: {
        displayMessage?: string;
        publishedAt?: string;
      };
      authorDetails?: {
        displayName?: string;
        channelId?: string;
      };
    }>;
    nextPageToken?: string;
    pollingIntervalMillis?: number;
    offlineAt?: string;
  };

  const messages: LiveChatMessage[] = (data.items ?? []).map((item) => ({
    id: item.id,
    authorName: item.authorDetails?.displayName ?? "Unknown",
    authorChannelId: item.authorDetails?.channelId ?? null,
    messageText: item.snippet?.displayMessage ?? "",
    publishedAt: new Date(item.snippet?.publishedAt ?? Date.now()),
    raw: item as unknown as Record<string, unknown>,
  }));

  return {
    messages,
    nextPageToken: data.nextPageToken ?? null,
    pollingIntervalMillis: data.pollingIntervalMillis ?? 5000,
    offlineAt: data.offlineAt ? new Date(data.offlineAt) : null,
  };
}
