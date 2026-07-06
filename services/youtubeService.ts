import { toJsonValue } from "@/lib/utils";
import { prisma } from "@/lib/db";
import {
  fetchYouTubeMetadata,
  parseYouTubeUrl,
  normalizeYouTubeUrl,
} from "@/lib/youtube";
import {
  parseStreamUrl,
  type StreamPlatform,
  type StreamEmbedInfo,
} from "@/lib/streamPlatform";
import {
  fetchStreamPlatformMetadata,
  withStreamEmbed,
} from "@/services/ytDlpMetadataService";

interface SessionMetadataInput {
  platform: StreamPlatform;
  sourceId: string;
  streamUrl: string;
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
  metadataJson: Record<string, unknown>;
}

async function resolveSessionMetadata(
  streamUrl: string
): Promise<SessionMetadataInput> {
  const parsed = parseStreamUrl(streamUrl);
  if (!parsed) {
    throw new Error(
      "Invalid stream URL. Use YouTube, Twitch (twitch.tv/channel or /videos/…), or Kick (kick.com/channel)."
    );
  }

  if (parsed.platform === "youtube") {
    const { videoId } = parseYouTubeUrl(streamUrl);
    const metadata = await fetchYouTubeMetadata(videoId);
    return {
      platform: "youtube",
      sourceId: videoId,
      streamUrl: normalizeYouTubeUrl(videoId),
      title: metadata.title,
      description: metadata.description,
      channelTitle: metadata.channelTitle,
      channelId: metadata.channelId,
      thumbnailUrl: metadata.thumbnailUrl,
      liveStatus: metadata.liveStatus,
      actualStartTime: metadata.actualStartTime,
      scheduledStartTime: metadata.scheduledStartTime,
      concurrentViewers: metadata.concurrentViewers,
      activeLiveChatId: metadata.activeLiveChatId,
      metadataJson: withStreamEmbed(metadata.raw, parsed.embed),
    };
  }

  const metadata = await fetchStreamPlatformMetadata(parsed);
  return {
    platform: parsed.platform,
    sourceId: metadata.sourceId || parsed.sourceId,
    streamUrl: parsed.canonicalUrl,
    title: metadata.title,
    description: metadata.description,
    channelTitle: metadata.channelTitle,
    channelId: metadata.channelId,
    thumbnailUrl: metadata.thumbnailUrl,
    liveStatus: metadata.liveStatus,
    actualStartTime: metadata.actualStartTime,
    scheduledStartTime: metadata.scheduledStartTime,
    concurrentViewers: metadata.concurrentViewers,
    activeLiveChatId: null,
    metadataJson: withStreamEmbed(metadata.raw, parsed.embed),
  };
}

export async function createStreamSession(streamUrl: string) {
  const meta = await resolveSessionMetadata(streamUrl);

  const session = await prisma.streamSession.create({
    data: {
      platform: meta.platform,
      youtubeVideoId: meta.sourceId,
      youtubeUrl: meta.streamUrl,
      title: meta.title,
      description: meta.description,
      channelTitle: meta.channelTitle,
      channelId: meta.channelId,
      thumbnailUrl: meta.thumbnailUrl,
      liveStatus: meta.liveStatus,
      actualStartTime: meta.actualStartTime,
      scheduledStartTime: meta.scheduledStartTime,
      concurrentViewers: meta.concurrentViewers,
      activeLiveChatId: meta.activeLiveChatId,
      metadataJson: toJsonValue(meta.metadataJson),
    },
  });

  return session;
}

/** Refresh live status from the source platform. */
export async function refreshSessionLiveMetadata(streamSessionId: string) {
  const session = await prisma.streamSession.findUnique({
    where: { id: streamSessionId },
  });
  if (!session) return null;

  const platform = (session.platform ?? "youtube") as StreamPlatform;
  const embed = (session.metadataJson as { streamEmbed?: StreamEmbedInfo } | null)
    ?.streamEmbed;

  if (platform === "youtube") {
    const metadata = await fetchYouTubeMetadata(session.youtubeVideoId);
    return prisma.streamSession.update({
      where: { id: streamSessionId },
      data: {
        title: metadata.title,
        liveStatus: metadata.liveStatus,
        actualStartTime: metadata.actualStartTime,
        scheduledStartTime: metadata.scheduledStartTime,
        concurrentViewers: metadata.concurrentViewers,
        activeLiveChatId: metadata.activeLiveChatId,
        metadataJson: toJsonValue(withStreamEmbed(metadata.raw, embed ?? {})),
      },
    });
  }

  const metadata = await fetchStreamPlatformMetadata({
    platform: session.platform as StreamPlatform,
    sourceId: session.youtubeVideoId,
    canonicalUrl: session.youtubeUrl,
    embed: embed ?? {},
  });

  return prisma.streamSession.update({
    where: { id: streamSessionId },
    data: {
      title: metadata.title,
      liveStatus: metadata.liveStatus,
      actualStartTime: metadata.actualStartTime,
      scheduledStartTime: metadata.scheduledStartTime,
      concurrentViewers: metadata.concurrentViewers,
      metadataJson: toJsonValue(withStreamEmbed(metadata.raw, embed ?? {})),
    },
  });
}

export async function getStreamSession(sessionId: string) {
  return prisma.streamSession.findUnique({
    where: { id: sessionId },
    include: {
      sourceMedia: { orderBy: { createdAt: "desc" }, take: 1 },
      clipSuggestions: { orderBy: { createdAt: "desc" } },
      renderJobs: { orderBy: { createdAt: "desc" }, take: 10 },
      chatTracking: true,
      liveRecording: true,
      _count: {
        select: {
          chatMessages: true,
          eventWindows: true,
          transcriptChunks: true,
          audioEvents: true,
          visualEvents: true,
        },
      },
    },
  });
}

/** @deprecated Use createStreamSession */
export async function createYouTubeStreamSession(youtubeUrl: string) {
  return createStreamSession(youtubeUrl);
}
