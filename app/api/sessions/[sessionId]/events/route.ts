import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { errorResponse, jsonResponse } from "@/lib/utils";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;

    const [eventWindows, transcriptChunks, audioEvents, visualEvents] =
      await Promise.all([
        prisma.eventWindow.findMany({
          where: { streamSessionId: sessionId },
          orderBy: { startTimeSeconds: "asc" },
        }),
        prisma.transcriptChunk.findMany({
          where: { streamSessionId: sessionId },
          orderBy: { startTimeSeconds: "asc" },
        }),
        prisma.audioEvent.findMany({
          where: { streamSessionId: sessionId },
          orderBy: { startTimeSeconds: "asc" },
        }),
        prisma.visualEvent.findMany({
          where: { streamSessionId: sessionId },
          orderBy: { startTimeSeconds: "asc" },
        }),
      ]);

    return jsonResponse({
      eventWindows,
      transcriptChunks,
      audioEvents,
      visualEvents,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch events";
    return errorResponse(message, 500);
  }
}
