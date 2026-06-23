import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { searchStreamContext } from "@/lib/rag";
import { askStreamAI } from "@/lib/ai";
import { errorResponse, jsonResponse, toJsonValue } from "@/lib/utils";

const askSchema = z.object({
  message: z.string().min(1),
});

function parseTimeFilter(message: string): {
  minTimeSeconds?: number;
  maxTimeSeconds?: number;
} {
  const lower = message.toLowerCase();
  if (lower.includes("last 30 minutes") || lower.includes("last 30 min")) {
    // Without knowing current stream position, use relative filter placeholder
    // Client can pass explicit filters in future API versions
    return {};
  }
  return {};
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const body = await request.json();
    const { message } = askSchema.parse(body);

    const session = await prisma.streamSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) return errorResponse("Session not found", 404);

    const timeFilter = parseTimeFilter(message);
    const context = await searchStreamContext(sessionId, message, {
      limit: 20,
      ...timeFilter,
    });

    const aiResponse = await askStreamAI(message, context, session.title ?? undefined);

    const createdClips = [];
    if (aiResponse.clipSuggestions?.length) {
      for (const clip of aiResponse.clipSuggestions) {
        const created = await prisma.clipSuggestion.create({
          data: {
            streamSessionId: sessionId,
            title: clip.title,
            startTimeSeconds: clip.startTimeSeconds,
            endTimeSeconds: clip.endTimeSeconds,
            reason: clip.reason,
            confidence: clip.confidence,
            suggestedLayout: clip.suggestedLayout,
            status: "suggested",
            rawAiJson: toJsonValue(clip),
          },
        });
        createdClips.push(created);
      }
    }

    return jsonResponse({
      answer: aiResponse.answer,
      clipSuggestions: createdClips,
      contextUsed: context.length,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(error.errors[0]?.message ?? "Invalid input", 400);
    }
    const message = error instanceof Error ? error.message : "AI request failed";
    return errorResponse(message, 500);
  }
}
