import { NextRequest } from "next/server";
import { processChatWindows } from "@/services/eventWindowService";
import { errorResponse, jsonResponse } from "@/lib/utils";

/** Re-score chat messages into hype event windows (no YouTube poll). */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const result = await processChatWindows(sessionId);
    return jsonResponse(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to sync chat windows";
    return errorResponse(message, 500);
  }
}
