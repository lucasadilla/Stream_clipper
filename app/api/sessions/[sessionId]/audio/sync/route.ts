import { NextRequest } from "next/server";
import { syncSessionAudioAnalysis } from "@/services/audioAnalysisService";
import { errorResponse, jsonResponse } from "@/lib/utils";

/** Run incremental or full audio analysis for timeline spikes / waveform. */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const result = await syncSessionAudioAnalysis(sessionId);
    return jsonResponse(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to sync audio analysis";
    return errorResponse(message, 500);
  }
}
