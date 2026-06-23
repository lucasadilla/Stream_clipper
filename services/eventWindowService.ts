import { toJsonValue } from "@/lib/utils";
import { prisma } from "@/lib/db";
import { createEmbedding } from "@/lib/embeddings";
import { storeEmbedding } from "@/lib/rag";
import {
  scoreChatWindow,
  buildChatWindowSummary,
} from "@/lib/scoring";
import { getWindowStart } from "@/lib/time";

const DEFAULT_WINDOW_SIZE = 30;
const MIN_SCORE_FOR_SUMMARY = 8;

export async function processChatWindows(
  streamSessionId: string,
  windowSizeSeconds = DEFAULT_WINDOW_SIZE
) {
  const messages = await prisma.chatMessage.findMany({
    where: { streamSessionId },
    orderBy: { publishedAt: "asc" },
  });

  if (messages.length === 0) return { windowsCreated: 0 };

  // Group messages into time windows
  const windows = new Map<number, typeof messages>();

  for (const msg of messages) {
    const time =
      msg.videoTimeSeconds ??
      (msg.publishedAt.getTime() - messages[0].publishedAt.getTime()) / 1000;
    const windowStart = getWindowStart(time, windowSizeSeconds);
    const existing = windows.get(windowStart) ?? [];
    existing.push(msg);
    windows.set(windowStart, existing);
  }

  let windowsCreated = 0;

  for (const [startTime, windowMessages] of windows) {
    const endTime = startTime + windowSizeSeconds;
    const metrics = scoreChatWindow(
      windowMessages.map((m) => ({
        authorName: m.authorName,
        authorChannelId: m.authorChannelId,
        messageText: m.messageText,
        videoTimeSeconds: m.videoTimeSeconds,
      }))
    );

    const summary =
      metrics.score >= MIN_SCORE_FOR_SUMMARY
        ? buildChatWindowSummary(startTime, endTime, metrics)
        : `Chat window ${startTime}s-${endTime}s: ${metrics.messageCount} messages.`;

    // Upsert by time range
    const existing = await prisma.eventWindow.findFirst({
      where: {
        streamSessionId,
        type: "chat_window",
        startTimeSeconds: startTime,
        endTimeSeconds: endTime,
      },
    });

    const rawData = {
      metrics,
      messageIds: windowMessages.map((m) => m.id),
    };

    let eventWindow;
    if (existing) {
      eventWindow = await prisma.eventWindow.update({
        where: { id: existing.id },
        data: { summary, score: metrics.score, rawData: toJsonValue(rawData) },
      });
    } else {
      eventWindow = await prisma.eventWindow.create({
        data: {
          streamSessionId,
          startTimeSeconds: startTime,
          endTimeSeconds: endTime,
          type: "chat_window",
          summary,
          score: metrics.score,
          rawData: toJsonValue(rawData),
        },
      });
      windowsCreated++;
    }

    // Embed high-scoring windows
    if (metrics.score >= MIN_SCORE_FOR_SUMMARY && summary) {
      try {
        const embedding = await createEmbedding(summary);
        await storeEmbedding("EventWindow", eventWindow.id, embedding);
      } catch (e) {
        console.warn("Failed to embed chat window:", e);
      }
    }
  }

  return { windowsCreated };
}
