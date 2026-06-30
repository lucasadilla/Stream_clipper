import { toJsonValue } from "@/lib/utils";
import { prisma } from "@/lib/db";
import {
  fetchYouTubeMetadata,
  parseYouTubeUrl,
  normalizeYouTubeUrl,
} from "@/lib/youtube";

export async function createStreamSession(youtubeUrl: string) {
  const { videoId, originalUrl } = parseYouTubeUrl(youtubeUrl);
  const metadata = await fetchYouTubeMetadata(videoId);

  const session = await prisma.streamSession.create({
    data: {
      youtubeVideoId: videoId,
      youtubeUrl: normalizeYouTubeUrl(videoId),
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
      metadataJson: toJsonValue(metadata.raw),
    },
  });

  return session;
}

/** Refresh live status and chat id from YouTube (streams can go live after session creation). */
export async function refreshSessionLiveMetadata(streamSessionId: string) {
  const session = await prisma.streamSession.findUnique({
    where: { id: streamSessionId },
  });
  if (!session) return null;

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
      metadataJson: toJsonValue(metadata.raw),
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
