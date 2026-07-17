import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import {
  clearWhisperTranscriptChunks,
  syncTranscription,
  waitForTranscriptionIdle,
} from "@/services/transcriptionSyncService";
import { errorResponse, jsonResponse } from "@/lib/utils";
import { canProcessMoreSeconds } from "@/services/usageService";
import { getBillingAccountIdFromRequest } from "@/services/billingService";
import {
  ensureSessionBillingAccess,
  SessionAccessError,
} from "@/services/sessionAccessService";
import { getPostHogClient } from "@/lib/posthog-server";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const billingAccountId = getBillingAccountIdFromRequest(request);

    try {
      await ensureSessionBillingAccess(sessionId, billingAccountId);
    } catch (err) {
      if (err instanceof SessionAccessError) {
        return errorResponse(err.message, err.status);
      }
      throw err;
    }

    const session = await prisma.streamSession.findUnique({
      where: { id: sessionId },
      select: {
        liveStatus: true,
        sourceMedia: {
          take: 1,
          select: { isLiveRecording: true },
        },
      },
    });
    if (!session) return errorResponse("Session not found", 404);

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
      // Never wipe transcripts while another sync is running — that left the
      // editor empty when rebuild returned skipped: sync_in_progress.
      const idle = await waitForTranscriptionIdle(sessionId, 20_000);
      if (!idle) {
        return jsonResponse({
          success: false,
          skipped: true,
          reason: "sync_in_progress",
          cleared: 0,
        });
      }
      cleared = await clearWhisperTranscriptChunks(sessionId);
    }

    const isLive =
      session.liveStatus === "live" ||
      session.liveStatus === "upcoming" ||
      session.sourceMedia[0]?.isLiveRecording === true;

    const result = await syncTranscription(sessionId, { isLive });
    if (result.skipped === true && rebuild && cleared > 0) {
      // Chunks were cleared but sync did not run — surface that so clients
      // do not treat this as a successful rebuild.
      return jsonResponse({
        success: false,
        cleared,
        ...result,
      });
    }
    if (billingAccountId) {
      getPostHogClient().capture({
        distinctId: billingAccountId,
        event: "transcription_completed",
        properties: {
          session_id: sessionId,
          is_live: isLive,
        },
      });
    }
    return jsonResponse({ success: true, cleared, ...result });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Transcription failed";
    console.error("[transcribe]", message);
    return errorResponse(message, 500);
  }
}
