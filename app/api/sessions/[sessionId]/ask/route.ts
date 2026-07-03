import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { searchStreamContext } from "@/lib/rag";
import {
  askStreamAI,
  bestTranscriptSimilarity,
  buildKeywordAnswer,
  getTranscriptContext,
  validateAskResponse,
} from "@/lib/ai";
import {
  USE_KEYWORD_FAST_PATH,
  USE_VECTOR_SEARCH_ON_ASK,
  KEYWORD_FAST_PATH_MIN_HITS,
  KEYWORD_FAST_PATH_MIN_SIMILARITY,
} from "@/lib/aiCostConstants";
import {
  isTemporalQuestion,
  keywordTranscriptSearch,
} from "@/services/transcriptSearchService";
import { errorResponse, jsonResponse } from "@/lib/utils";
import type { RagSearchResult } from "@/lib/rag";

const SIMILARITY_THRESHOLD = 0.25;

function sortByRelevance(results: RagSearchResult[]): RagSearchResult[] {
  return [...results].sort((a, b) => {
    const simDiff = (b.similarity ?? 0) - (a.similarity ?? 0);
    if (simDiff !== 0) return simDiff;
    return (b.score ?? 0) - (a.score ?? 0);
  });
}

function mergeContext(
  vector: RagSearchResult[],
  keyword: RagSearchResult[]
): RagSearchResult[] {
  const seen = new Set<string>();
  const merged: RagSearchResult[] = [];
  for (const hit of [...keyword, ...vector]) {
    // Key on content+time as well as id: duplicate transcript rows can exist.
    const key = `${hit.startTimeSeconds ?? ""}|${hit.text}`;
    if (seen.has(hit.id) || seen.has(key)) continue;
    seen.add(hit.id);
    seen.add(key);
    merged.push(hit);
  }
  return merged;
}

const askSchema = z.object({
  message: z.string().min(1),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      })
    )
    .max(12)
    .optional(),
});

function parseTimeFilter(_message: string): {
  minTimeSeconds?: number;
  maxTimeSeconds?: number;
} {
  return {};
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const body = await request.json();
    const { message, history = [] } = askSchema.parse(body);

    const session = await prisma.streamSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) return errorResponse("Session not found", 404);

    const timeFilter = parseTimeFilter(message);
    const keywordContext = await keywordTranscriptSearch(sessionId, message, 12);

    let vectorContext: RagSearchResult[] = [];
    if (USE_VECTOR_SEARCH_ON_ASK || keywordContext.length === 0) {
      vectorContext = await searchStreamContext(sessionId, message, {
        limit: 12,
        ...timeFilter,
      });
    }

    const context = sortByRelevance(
      mergeContext(vectorContext, keywordContext)
    );

    const transcriptCtx = getTranscriptContext(context);

    if (transcriptCtx.length === 0) {
      return jsonResponse({
        found: false,
        answer:
          "No transcript yet — audio is still being transcribed. Wait a minute and try again.",
        timestamps: [],
        contextUsed: 0,
      });
    }

    const bestSim = bestTranscriptSimilarity(context);
    const hasKeywordHits = keywordContext.length > 0;
    if (bestSim < SIMILARITY_THRESHOLD && !hasKeywordHits) {
      return jsonResponse({
        found: false,
        answer:
          "I couldn't find anything about that in the transcript so far. Try different wording or wait for more of the stream to be transcribed.",
        timestamps: [],
        contextUsed: transcriptCtx.length,
      });
    }

    const bestKeywordSim = keywordContext[0]?.similarity ?? 0;

    // Strong keyword hit → return excerpt + timestamp without GPT (saves $ per question).
    // Skip for "when did X happen?" — those need GPT to pick the right moment.
    if (
      USE_KEYWORD_FAST_PATH &&
      !isTemporalQuestion(message) &&
      keywordContext.length >= KEYWORD_FAST_PATH_MIN_HITS &&
      bestKeywordSim >= KEYWORD_FAST_PATH_MIN_SIMILARITY
    ) {
      const fast = buildKeywordAnswer(message, keywordContext);
      const validated = validateAskResponse(fast, context);
      return jsonResponse({
        found: validated.found,
        answer: validated.answer,
        timestamps: validated.timestamps ?? [],
        contextUsed: transcriptCtx.length,
      });
    }

    const aiResponse = await askStreamAI(
      message,
      context,
      session.title ?? undefined,
      history
    );

    const validated = validateAskResponse(aiResponse, context);

    return jsonResponse({
      found: validated.found,
      answer: validated.answer,
      timestamps: validated.timestamps ?? [],
      contextUsed: transcriptCtx.length,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(error.errors[0]?.message ?? "Invalid input", 400);
    }
    const message = error instanceof Error ? error.message : "AI request failed";
    if (/invalid JSON|missing required fields/i.test(message)) {
      return jsonResponse({
        found: false,
        answer: "Something went wrong formatting the AI reply — please try again.",
        timestamps: [],
        contextUsed: 0,
      });
    }
    if (/exceeded your current quota/i.test(message)) {
      return jsonResponse({
        found: false,
        answer:
          "The AI provider is out of credits, so I can't search the transcript right now. Add credits and try again.",
        timestamps: [],
        contextUsed: 0,
      });
    }
    return errorResponse(message, 500);
  }
}
