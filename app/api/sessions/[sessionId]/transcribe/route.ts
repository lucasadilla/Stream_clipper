import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { syncTranscription } from "@/services/transcriptionSyncService";
import { errorResponse, jsonResponse } from "@/lib/utils";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const session = await prisma.streamSession.findUnique({
      where: { id: sessionId },
      select: { liveStatus: true },
    });
    if (!session) return errorResponse("Session not found", 404);

    const isLive =
      session.liveStatus === "live" || session.liveStatus === "upcoming";

    const result = await syncTranscription(sessionId, { isLive });
    return jsonResponse({ success: true, ...result });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Transcription failed";
    console.error("[transcribe]", message);
    return errorResponse(message, 500);
  }
}
