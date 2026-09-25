import { NextRequest } from "next/server";
import { getTimelineThumbnails } from "@/services/timelineThumbnailService";
import { prisma } from "@/lib/db";
import { errorResponse, jsonResponse } from "@/lib/utils";
import { REPLACED_SESSION_STATUS } from "@/services/sessionCleanupService";
import { getBillingAccountIdFromRequest } from "@/services/billingService";
import {
  ensureSessionBillingAccess,
  SessionAccessError,
} from "@/services/sessionAccessService";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    await ensureSessionBillingAccess(
      sessionId,
      getBillingAccountIdFromRequest(request)
    );
    const session = await prisma.streamSession.findUnique({
      where: { id: sessionId },
      select: { liveStatus: true, platform: true },
    });
    if (!session || session.liveStatus === REPLACED_SESSION_STATUS) {
      return errorResponse("Session not found", 404);
    }
    const isLive =
      session.liveStatus === "live" || session.liveStatus === "upcoming";

    const thumbnails = await getTimelineThumbnails(sessionId, {
      isLive,
      platform: session.platform,
    });
    return jsonResponse({ thumbnails });
  } catch (error) {
    if (error instanceof SessionAccessError) {
      return errorResponse(error.message, error.status);
    }
    const message =
      error instanceof Error ? error.message : "Failed to load thumbnails";
    return errorResponse(message, 500);
  }
}
