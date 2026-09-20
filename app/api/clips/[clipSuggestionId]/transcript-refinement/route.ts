import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { errorResponse, jsonResponse } from "@/lib/utils";
import { getBillingAccountIdFromRequest } from "@/services/billingService";
import { refineClipTranscript } from "@/services/clipTranscriptRefinementService";
import {
  ensureSessionBillingAccess,
  SessionAccessError,
} from "@/services/sessionAccessService";

export const runtime = "nodejs";
export const maxDuration = 90;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ clipSuggestionId: string }> }
) {
  try {
    const { clipSuggestionId } = await params;
    const clip = await prisma.clipSuggestion.findUnique({
      where: { id: clipSuggestionId },
      select: { streamSessionId: true },
    });
    if (!clip) throw new SessionAccessError("Clip not found", 404);
    await ensureSessionBillingAccess(
      clip.streamSessionId,
      getBillingAccountIdFromRequest(request)
    );
    return jsonResponse(await refineClipTranscript(clipSuggestionId));
  } catch (error) {
    if (error instanceof SessionAccessError) {
      return errorResponse(error.message, error.status);
    }
    console.error("[transcript-refinement] failed:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Transcript refinement failed",
      500
    );
  }
}
