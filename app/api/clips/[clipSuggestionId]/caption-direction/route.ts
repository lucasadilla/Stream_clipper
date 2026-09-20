import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { errorResponse, jsonResponse } from "@/lib/utils";
import { getBillingAccountIdFromRequest } from "@/services/billingService";
import {
  ensureSessionBillingAccess,
  SessionAccessError,
} from "@/services/sessionAccessService";
import { getCaptionDirectionForClip } from "@/services/captionDirectorService";

export const runtime = "nodejs";
export const maxDuration = 30;

async function authorizeClip(request: NextRequest, clipSuggestionId: string) {
  const clip = await prisma.clipSuggestion.findUnique({
    where: { id: clipSuggestionId },
    select: { id: true, streamSessionId: true },
  });
  if (!clip) throw new SessionAccessError("Clip not found", 404);
  await ensureSessionBillingAccess(
    clip.streamSessionId,
    getBillingAccountIdFromRequest(request)
  );
  return clip;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ clipSuggestionId: string }> }
) {
  try {
    const { clipSuggestionId } = await params;
    await authorizeClip(request, clipSuggestionId);
    const { plan } = await getCaptionDirectionForClip(clipSuggestionId);
    return jsonResponse({ plan });
  } catch (error) {
    if (error instanceof SessionAccessError) {
      return errorResponse(error.message, error.status);
    }
    return errorResponse(
      error instanceof Error ? error.message : "Caption direction failed",
      500
    );
  }
}
