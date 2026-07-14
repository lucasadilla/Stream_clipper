import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { errorResponse, jsonResponse } from "@/lib/utils";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;

    const [eventWindows, transcriptChunks, audioEvents] = await Promise.all([
      prisma.eventWindow.findMany({
        where: { streamSessionId: sessionId },
        orderBy: { startTimeSeconds: "asc" },
        select: {
          id: true,
          startTimeSeconds: true,
          endTimeSeconds: true,
          type: true,
          summary: true,
          score: true,
        },
      }),
      prisma.transcriptChunk.findMany({
        where: { streamSessionId: sessionId },
        orderBy: { startTimeSeconds: "asc" },
        select: {
          id: true,
          startTimeSeconds: true,
          endTimeSeconds: true,
          text: true,
          rawJson: true,
        },
      }),
      prisma.audioEvent.findMany({
        where: { streamSessionId: sessionId },
        orderBy: { startTimeSeconds: "asc" },
        select: {
          id: true,
          startTimeSeconds: true,
          endTimeSeconds: true,
          type: true,
          score: true,
          summary: true,
        },
      }),
    ]);

    return jsonResponse({
      eventWindows,
      transcriptChunks,
      audioEvents,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch events";
    return errorResponse(message, 500);
  }
}
