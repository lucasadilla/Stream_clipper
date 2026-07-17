import { prisma } from "@/lib/db";
import {
  searchStreamContext,
  type RagSearchResult,
} from "@/lib/rag";
import {
  findClipAI,
  getTranscriptContext,
  validateFindClipResponse,
  type ClipSuggestionInput,
} from "@/lib/ai";
import { toJsonValue } from "@/lib/utils";
import {
  buildSpecificClipTitle,
  buildSpecificClipReason,
  clipLengthFromMoment,
} from "@/lib/clipDescriptions";
import { renderShort } from "@/services/renderService";
import type { CaptionAppearance } from "@/lib/captionAppearance";
import {
  keywordTranscriptSearch,
  estimateTimestampInChunk,
} from "@/services/transcriptSearchService";
import { USE_VECTOR_SEARCH_ON_ASK } from "@/lib/aiCostConstants";
import { isPlaceholderTranscript } from "@/services/transcriptionSyncService";

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

  const chat: Array<{ authorName?: string; messageText: string }> =
    chatMessages.map((m) => ({
      authorName: m.authorName,
      messageText: m.messageText,
    }));

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

function mergeContext(
  vector: RagSearchResult[],
  keyword: RagSearchResult[]
): RagSearchResult[] {
  const seen = new Set<string>();
  const merged: RagSearchResult[] = [];
  for (const hit of [...keyword, ...vector]) {
    const key = `${hit.startTimeSeconds ?? ""}|${hit.text}`;
    if (seen.has(hit.id) || seen.has(key)) continue;
    seen.add(hit.id);
    seen.add(key);
    merged.push(hit);
  }
  return merged;
}

function sortByRelevance(results: RagSearchResult[]): RagSearchResult[] {
  return [...results].sort((a, b) => {
    const simDiff = (b.similarity ?? 0) - (a.similarity ?? 0);
    if (simDiff !== 0) return simDiff;
    return (b.score ?? 0) - (a.score ?? 0);
  });
}

async function getRecentTranscriptContext(
  streamSessionId: string,
  limit = 24
): Promise<RagSearchResult[]> {
  const chunks = await prisma.transcriptChunk.findMany({
    where: {
      streamSessionId,
      NOT: { text: { in: ["[silence]", "[processing error]"] } },
    },
    orderBy: { startTimeSeconds: "desc" },
    take: limit * 2,
  });

  return chunks
    .filter((c) => !isPlaceholderTranscript(c.text) && c.text.trim().length > 0)
    .slice(0, limit)
    .reverse()
    .map((c) => ({
      id: c.id,
      sourceType: "transcript" as const,
      startTimeSeconds: c.startTimeSeconds,
      endTimeSeconds: c.endTimeSeconds,
      text: c.text,
      score: 0,
      similarity: 0.2,
    }));
}

function clipInputFromKeywordHit(
  hit: RagSearchResult,
  description: string
): ClipSuggestionInput {
  const chunkStart = hit.startTimeSeconds ?? 0;
  const chunkEnd = hit.endTimeSeconds ?? chunkStart + 20;
  const anchor = estimateTimestampInChunk(
    hit.text,
    chunkStart,
    chunkEnd,
    description
  );
  const { start, end } = clipLengthFromMoment(
    anchor,
    Math.min(chunkEnd, anchor + 12)
  );
  return {
    title: buildSpecificClipTitle({
      startTimeSeconds: start,
      endTimeSeconds: end,
      transcriptText: hit.text,
    }),
    startTimeSeconds: start,
    endTimeSeconds: end,
    reason: buildSpecificClipReason({
      startTimeSeconds: start,
      endTimeSeconds: end,
      transcriptText: hit.text,
    }),
    confidence: Math.min(0.88, 0.55 + (hit.similarity ?? 0.2)),
    suggestedLayout: "center_crop",
  };
}

export type FindClipResult =
  | {
      found: true;
      answer: string;
      clip: Awaited<ReturnType<typeof prisma.clipSuggestion.create>>;
      renderJob: {
        jobId: string;
        outputPath?: string;
        downloadUrl: string;
      } | null;
      contextUsed: number;
    }
  | {
      found: false;
      answer: string;
      clip: null;
      renderJob: null;
      contextUsed: number;
    };

/**
 * User describes what happened → keyword + RAG + AI finds the moment → optional render.
 * Soft-fails with found:false instead of throwing when nothing matches.
 */
export async function findClipFromDescription(
  streamSessionId: string,
  description: string,
  options: {
    autoRender?: boolean;
    includeCaptions?: boolean;
    captionAppearance?: CaptionAppearance;
  } = {}
): Promise<FindClipResult> {
  const session = await prisma.streamSession.findUnique({
    where: { id: streamSessionId },
    include: {
      sourceMedia: { take: 1, orderBy: { createdAt: "desc" } },
      liveRecording: true,
      _count: { select: { transcriptChunks: true } },
    },
  });
  if (!session) throw new Error("Session not found");

  const keywordContext = await keywordTranscriptSearch(
    streamSessionId,
    description,
    20
  );

  let vectorContext: RagSearchResult[] = [];
  if (USE_VECTOR_SEARCH_ON_ASK || keywordContext.length === 0) {
    try {
      vectorContext = await searchStreamContext(streamSessionId, description, {
        limit: 20,
      });
    } catch {
      vectorContext = [];
    }
  }

  let context = sortByRelevance(mergeContext(vectorContext, keywordContext));
  let transcriptCtx = getTranscriptContext(context);

  if (transcriptCtx.length === 0) {
    const recent = await getRecentTranscriptContext(streamSessionId, 24);
    context = sortByRelevance(mergeContext(context, recent));
    transcriptCtx = getTranscriptContext(context);
  }

  if (transcriptCtx.length === 0) {
    const chunkCount = session._count.transcriptChunks;
    return {
      found: false,
      answer:
        chunkCount === 0
          ? "No searchable transcript yet — audio is still being transcribed. Wait a bit and try again."
          : "Transcript is still mostly placeholders or silence. Wait for more speech to be processed, then try again.",
      clip: null,
      renderJob: null,
      contextUsed: 0,
    };
  }

  let clipInput: ClipSuggestionInput | null = null;
  let answer = "";

  try {
    const aiRaw = await findClipAI(
      description,
      context,
      session.title ?? undefined
    );
    const validated = validateFindClipResponse(aiRaw, context);
    if (validated.found) {
      clipInput = validated.clip;
      answer = validated.answer;
    } else {
      answer = validated.answer;
    }
  } catch (err) {
    answer =
      err instanceof Error
        ? err.message
        : "Something went wrong asking the AI — try again.";
  }

  if (!clipInput && keywordContext[0]) {
    clipInput = clipInputFromKeywordHit(keywordContext[0], description);
    answer =
      answer ||
      "Matched transcript near this wording and built a clip around it.";
  }

  if (!clipInput) {
    return {
      found: false,
      answer:
        answer ||
        "I couldn't find that moment in the transcript available so far. Try quoting words that were said, or wait for more of the stream to be transcribed.",
      clip: null,
      renderJob: null,
      contextUsed: transcriptCtx.length,
    };
  }

  const clip = await prisma.clipSuggestion.create({
    data: {
      streamSessionId,
      title: clipInput.title,
      startTimeSeconds: clipInput.startTimeSeconds,
      endTimeSeconds: clipInput.endTimeSeconds,
      reason: clipInput.reason,
      confidence: clipInput.confidence,
      suggestedLayout: clipInput.suggestedLayout,
      status: "saved",
      rawAiJson: toJsonValue({
        source: "find_clip",
        query: description,
        ...clipInput,
      }),
    },
  });

  let renderJob: {
    jobId: string;
    outputPath?: string;
    downloadUrl: string;
  } | null = null;

  if (options.autoRender !== false) {
    const sourceMedia = session.sourceMedia[0];
    try {
      const result = await renderShort({
        streamSessionId,
        sourceMediaId: sourceMedia?.id,
        clipSuggestionId: clip.id,
        startTimeSeconds: clipInput.startTimeSeconds,
        endTimeSeconds: clipInput.endTimeSeconds,
        format: "vertical",
        layout: clipInput.suggestedLayout,
        includeCaptions: options.includeCaptions ?? true,
        captionAppearance: options.captionAppearance,
      });
      renderJob = {
        jobId: result.jobId,
        outputPath: result.outputPath,
        downloadUrl: `/api/clips/${clip.id}/download`,
      };
    } catch (err) {
      answer = `${answer} (Clip saved — render failed: ${
        err instanceof Error ? err.message : "unknown error"
      })`;
    }
  }

  return {
    found: true,
    answer,
    clip,
    renderJob,
    contextUsed: transcriptCtx.length,
  };
}
