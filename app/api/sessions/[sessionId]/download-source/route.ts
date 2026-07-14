import { NextRequest } from "next/server";
import { acquireSourceMedia } from "@/services/liveRecordingService";
import { errorResponse, jsonResponse } from "@/lib/utils";
import { getBillingAccountIdFromRequest } from "@/services/billingService";
import {
  ensureSessionBillingAccess,
  SessionAccessError,
} from "@/services/sessionAccessService";
import { canUseSourceDuration } from "@/services/usageService";
import { formatYtDlpUserError } from "@/services/youtubeDownloadService";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const billingAccountId = getBillingAccountIdFromRequest(request);
    await ensureSessionBillingAccess(sessionId, billingAccountId);
    const result = await acquireSourceMedia(sessionId);
    const media = result.sourceMedia;
    if (media?.durationSeconds) {
      const gate = await canUseSourceDuration(
        billingAccountId,
        media.durationSeconds
      );
      if (!gate.allowed) {
        return errorResponse(gate.message ?? "Source video is too long", gate.status ?? 400);
      }
    }
    return jsonResponse({
      ...result,
      sourceMedia: media
        ? { ...media, sizeBytes: media.sizeBytes.toString() }
        : null,
    });
  } catch (error) {
    if (error instanceof SessionAccessError) {
      return errorResponse(error.message, error.status);
    }
    const message = formatYtDlpUserError(error);
    return errorResponse(message, 500);
  }
}
