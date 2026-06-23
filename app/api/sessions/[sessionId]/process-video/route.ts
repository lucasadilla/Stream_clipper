import { NextRequest } from "next/server";
import { processVideo } from "@/services/mediaService";
import { processChatWindows } from "@/services/eventWindowService";
import { errorResponse, jsonResponse } from "@/lib/utils";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const result = await processVideo(sessionId);
    await processChatWindows(sessionId);
    return jsonResponse({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Processing failed";
    return errorResponse(message, 500);
  }
}
