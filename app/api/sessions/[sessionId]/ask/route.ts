import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { searchStreamContext } from "@/lib/rag";
import {
  askStreamAI,
  bestTranscriptSimilarity,
  getTranscriptContext,
  validateAskResponse,
} from "@/lib/ai";
import { keywordTranscriptSearch } from "@/services/transcriptSearchService";
import { errorResponse, jsonResponse } from "@/lib/utils";
import type { RagSearchResult } from "@/lib/rag";

const SIMILARITY_THRESHOLD = 0.25;

function mergeContext(
  vector: RagSearchResult[],
  keyword: RagSearchResult[]
): RagSearchResult[] {
  const seen = new Set(vector.map((r) => r.id));
  const merged = [...vector];
  for (const hit of keyword) {
    if (!seen.has(hit.id)) {
      merged.push(hit);
      seen.add(hit.id);
    }
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
    const [vectorContext, keywordContext] = await Promise.all([
      searchStreamContext(sessionId, message, {
        limit: 20,
        ...timeFilter,
      }),
      keywordTranscriptSearch(sessionId, message, 12),
    ]);

    const context = mergeContext(vectorContext, keywordContext);

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
    return errorResponse(message, 500);
  }
}
