import { toJsonValue } from "@/lib/utils";
import { prisma } from "@/lib/db";
import { fetchLiveChatMessages } from "@/lib/youtube";

export async function startChatTracking(streamSessionId: string) {
  const session = await prisma.streamSession.findUnique({
    where: { id: streamSessionId },
  });

  if (!session) throw new Error("Session not found");
  if (!session.activeLiveChatId) {
    throw new Error("No active live chat available for this stream");
  }

  const tracking = await prisma.chatTrackingState.upsert({
    where: { streamSessionId },
    create: {
      streamSessionId,
      isActive: true,
      startedAt: new Date(),
    },
    update: {
      isActive: true,
      startedAt: new Date(),
    },
  });

  // Run initial poll
  const result = await pollChatMessages(streamSessionId);
  return { tracking, ...result };
}

export async function pollChatMessages(streamSessionId: string) {
  const session = await prisma.streamSession.findUnique({
    where: { id: streamSessionId },
    include: { chatTracking: true },
  });

  if (!session?.activeLiveChatId) {
    throw new Error("No active live chat");
  }

  const tracking = session.chatTracking;
  const pageToken = tracking?.nextPageToken ?? undefined;

  const pollResult = await fetchLiveChatMessages(
    session.activeLiveChatId,
    pageToken
  );

  // Respect YouTube polling interval
  if (tracking?.lastPolledAt) {
    const elapsed = Date.now() - tracking.lastPolledAt.getTime();
    const minInterval = Math.max(
      pollResult.pollingIntervalMillis,
      tracking.pollingInterval,
      3000
    );
    if (elapsed < minInterval) {
      return {
        newMessages: 0,
        pollingIntervalMillis: minInterval,
        skipped: true,
      };
    }
  }

  let newCount = 0;
  const streamStart = session.actualStartTime;

  for (const msg of pollResult.messages) {
    let videoTimeSeconds: number | null = null;
    if (streamStart) {
      videoTimeSeconds =
        (msg.publishedAt.getTime() - streamStart.getTime()) / 1000;
      if (videoTimeSeconds < 0) videoTimeSeconds = null;
    }

    try {
      await prisma.chatMessage.create({
        data: {
          streamSessionId,
          youtubeMessageId: msg.id,
          authorName: msg.authorName,
          authorChannelId: msg.authorChannelId,
          messageText: msg.messageText,
          publishedAt: msg.publishedAt,
          videoTimeSeconds,
          rawJson: toJsonValue(msg.raw),
        },
      });
      newCount++;
    } catch {
      // Duplicate message — skip
    }
  }

  await prisma.chatTrackingState.upsert({
    where: { streamSessionId },
    create: {
      streamSessionId,
      isActive: !pollResult.offlineAt,
      nextPageToken: pollResult.nextPageToken,
      pollingInterval: pollResult.pollingIntervalMillis,
      lastPolledAt: new Date(),
    },
    update: {
      isActive: pollResult.offlineAt ? false : true,
      nextPageToken: pollResult.nextPageToken,
      pollingInterval: pollResult.pollingIntervalMillis,
      lastPolledAt: new Date(),
    },
  });

  return {
    newMessages: newCount,
    pollingIntervalMillis: pollResult.pollingIntervalMillis,
    offline: !!pollResult.offlineAt,
  };
}

export async function getChatMessages(
  streamSessionId: string,
  limit = 200
) {
  return prisma.chatMessage.findMany({
    where: { streamSessionId },
    orderBy: { publishedAt: "asc" },
    take: limit,
  });
}

/**
 * Poll loop for background worker migration.
 * Call from a cron job or worker process in production.
 */
export async function runChatPollingLoop(
  streamSessionId: string,
  maxIterations = 1
): Promise<void> {
  for (let i = 0; i < maxIterations; i++) {
    const tracking = await prisma.chatTrackingState.findUnique({
      where: { streamSessionId },
    });
    if (!tracking?.isActive) break;

    const result = await pollChatMessages(streamSessionId);
    if ("skipped" in result && result.skipped) break;

    if (maxIterations > 1) {
      await new Promise((r) =>
        setTimeout(r, result.pollingIntervalMillis ?? 5000)
      );
    }
  }
}
