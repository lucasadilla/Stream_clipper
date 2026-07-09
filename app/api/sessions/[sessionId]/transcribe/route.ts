import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import {
  clearWhisperTranscriptChunks,
  syncTranscription,
} from "@/services/transcriptionSyncService";
import { errorResponse, jsonResponse } from "@/lib/utils";
import { canProcessMoreSeconds } from "@/services/usageService";
import { getBillingAccountIdFromRequest } from "@/services/billingService";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const session = await prisma.streamSession.findUnique({
      where: { id: sessionId },
      select: { liveStatus: true, billingAccountId: true },
    });
    if (!session) return errorResponse("Session not found", 404);

    const billingAccountId = getBillingAccountIdFromRequest(request);
    if (!billingAccountId || billingAccountId !== session.billingAccountId) {
      return errorResponse("Choose the paid plan that owns this session to transcribe it.", 402);
    }

    const usageGate = await canProcessMoreSeconds(billingAccountId);
    if (!usageGate.allowed) {
      return errorResponse(
        usageGate.message ?? "Plan limit reached",
        usageGate.status ?? 402
      );
    }

    const rebuild = request.nextUrl.searchParams.get("rebuild") === "1";
    let cleared = 0;
    if (rebuild) {
      cleared = await clearWhisperTranscriptChunks(sessionId);
    }

    const isLive =
      session.liveStatus === "live" || session.liveStatus === "upcoming";

    const result = await syncTranscription(sessionId, { isLive });
    return jsonResponse({ success: true, cleared, ...result });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Transcription failed";
    console.error("[transcribe]", message);
    return errorResponse(message, 500);
  }
}
