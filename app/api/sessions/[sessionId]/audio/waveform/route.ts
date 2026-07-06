import { NextRequest } from "next/server";
import { getTimelineWaveform } from "@/services/audioAnalysisService";
import { errorResponse, jsonResponse } from "@/lib/utils";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const maxTime = parseFloat(
      request.nextUrl.searchParams.get("maxTime") ?? "0"
    );
    if (!Number.isFinite(maxTime) || maxTime <= 0) {
      return jsonResponse({ buckets: [] });
    }

    const buckets = await getTimelineWaveform(sessionId, maxTime);
    return jsonResponse({ buckets });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load audio waveform";
    return errorResponse(message, 500);
  }
}
