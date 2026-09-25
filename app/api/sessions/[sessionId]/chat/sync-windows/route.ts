import { NextRequest } from "next/server";
import { processChatWindows } from "@/services/eventWindowService";
import { errorResponse, jsonResponse } from "@/lib/utils";
import { getBillingAccountIdFromRequest } from "@/services/billingService";
import {
  ensureSessionBillingAccess,
  SessionAccessError,
} from "@/services/sessionAccessService";

/** Re-score chat messages into hype event windows (no YouTube poll). */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    await ensureSessionBillingAccess(
      sessionId,
      getBillingAccountIdFromRequest(request)
    );
    const result = await processChatWindows(sessionId);
    return jsonResponse(result);
  } catch (error) {
    if (error instanceof SessionAccessError) {
      return errorResponse(error.message, error.status);
    }
    const message =
      error instanceof Error ? error.message : "Failed to sync chat windows";
    return errorResponse(message, 500);
  }
}
