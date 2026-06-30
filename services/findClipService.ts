import { prisma } from "@/lib/db";
import { searchStreamContext } from "@/lib/rag";
import { findClipAI } from "@/lib/ai";
import { toJsonValue } from "@/lib/utils";
import {
  buildSpecificClipTitle,
  buildSpecificClipReason,
  clipLengthFromMoment,
} from "@/lib/clipDescriptions";
import { renderShort } from "@/services/renderService";

interface WindowRawData {
  metrics?: {
    topMessages?: string[];
    hypeHits?: string[];
  };
  messageIds?: string[];
}

async function getChatInRange(
  streamSessionId: string,
  start: number,
  end: number
) {
  const byTime = await prisma.chatMessage.findMany({
    where: {
      streamSessionId,
      videoTimeSeconds: { gte: start, lte: end },
    },
    orderBy: { publishedAt: "asc" },
    take: 12,
  });
  if (byTime.length > 0) return byTime;

  // Fallback: messages without video time — match by window via stored IDs later
  return prisma.chatMessage.findMany({
    where: { streamSessionId },
    orderBy: { publishedAt: "desc" },
    take: 8,
  });
}

async function getTranscriptInRange(
  streamSessionId: string,
  start: number,
  end: number
) {
  const chunks = await prisma.transcriptChunk.findMany({
    where: {
      streamSessionId,
      startTimeSeconds: { lte: end },
      endTimeSeconds: { gte: start },
    },
    orderBy: { startTimeSeconds: "asc" },
    take: 3,
  });
  return chunks.map((c) => c.text).join(" ");
}

export async function enrichEventWindowClip(
  streamSessionId: string,
  window: {
    startTimeSeconds: number;
    endTimeSeconds: number;
    summary: string | null;
    score: number;
    rawData: unknown;
  }
) {
  const raw = window.rawData as WindowRawData | null;
  const { start, end } = clipLengthFromMoment(
    window.startTimeSeconds,
    window.endTimeSeconds
  );

  const [chatMessages, transcriptText] = await Promise.all([
    getChatInRange(streamSessionId, window.startTimeSeconds, window.endTimeSeconds),
    getTranscriptInRange(streamSessionId, start, end),
  ]);

  const chat: Array<{ authorName?: string; messageText: string }> = chatMessages.map((m) => ({
    authorName: m.authorName,
    messageText: m.messageText,
  }));

  // Fall back to top messages stored in window metrics
  if (chat.length === 0 && raw?.metrics?.topMessages?.length) {
    for (const text of raw.metrics.topMessages) {
      chat.push({ messageText: text });
    }
  }

  const title = buildSpecificClipTitle({
    startTimeSeconds: start,
    endTimeSeconds: end,
    chatMessages: chat,
    transcriptText,
    hypeHits: raw?.metrics?.hypeHits,
  });

  const reason = buildSpecificClipReason({
    startTimeSeconds: start,
    endTimeSeconds: end,
    chatMessages: chat,
    transcriptText,
    eventSummary: window.summary,
    hypeHits: raw?.metrics?.hypeHits,
  });

  return {
    start,
    end,
    title,
    reason,
    confidence: Math.min(0.95, 0.5 + window.score / 50),
  };
}

/**
 * User describes what happened → RAG + AI finds the exact moment → optional instant render.
 */
export async function findClipFromDescription(
  streamSessionId: string,
  description: string,
  options: { autoRender?: boolean } = {}
) {
  const session = await prisma.streamSession.findUnique({
    where: { id: streamSessionId },
    include: {
      sourceMedia: { take: 1, orderBy: { createdAt: "desc" } },
      liveRecording: true,
    },
  });
  if (!session) throw new Error("Session not found");

  const context = await searchStreamContext(streamSessionId, description, {
    limit: 30,
  });

  const aiResult = await findClipAI(
    description,
    context,
    session.title ?? undefined
  );
  const ai = aiResult.clipSuggestions[0];

  const clip = await prisma.clipSuggestion.create({
    data: {
      streamSessionId,
      title: ai.title,
      startTimeSeconds: ai.startTimeSeconds,
      endTimeSeconds: ai.endTimeSeconds,
      reason: ai.reason,
      confidence: ai.confidence,
      suggestedLayout: ai.suggestedLayout,
      status: "saved",
      rawAiJson: toJsonValue({ source: "find_clip", query: description, ...ai }),
    },
  });

  let renderJob = null;
  if (options.autoRender) {
    const sourceMedia = session.sourceMedia[0];

    const result = await renderShort({
      streamSessionId,
      sourceMediaId: sourceMedia?.id,
      clipSuggestionId: clip.id,
      startTimeSeconds: ai.startTimeSeconds,
      endTimeSeconds: ai.endTimeSeconds,
      format: "vertical",
      layout: ai.suggestedLayout,
      includeCaptions: false,
    });
    renderJob = {
      jobId: result.jobId,
      outputPath: result.outputPath,
      downloadUrl: `/api/clips/${clip.id}/download`,
    };
  }

  return {
    clip,
    answer: aiResult.answer,
    renderJob,
  };
}
