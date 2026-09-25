import { NextRequest } from "next/server";
import { syncSessionAudioAnalysis } from "@/services/audioAnalysisService";
import { errorResponse, jsonResponse } from "@/lib/utils";
import { getBillingAccountIdFromRequest } from "@/services/billingService";
import {
  ensureSessionBillingAccess,
  SessionAccessError,
} from "@/services/sessionAccessService";

/** Run incremental or full audio analysis for timeline spikes / waveform. */
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
    const result = await syncSessionAudioAnalysis(sessionId);
    return jsonResponse(result);
  } catch (error) {
    if (error instanceof SessionAccessError) {
      return errorResponse(error.message, error.status);
    }
    const message =
      error instanceof Error ? error.message : "Failed to sync audio analysis";
    return errorResponse(message, 500);
  }
}
