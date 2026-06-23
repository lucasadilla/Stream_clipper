import { NextRequest } from "next/server";
import {
  startChatTracking,
  pollChatMessages,
} from "@/services/chatIngestionService";
import { processChatWindows } from "@/services/eventWindowService";
import { errorResponse, jsonResponse } from "@/lib/utils";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const body = await request.json().catch(() => ({}));
    const action = (body as { action?: string }).action ?? "start";

    if (action === "poll") {
      const pollResult = await pollChatMessages(sessionId);
      const windows = await processChatWindows(sessionId);
      return jsonResponse({ ...pollResult, ...windows });
    }

    const result = await startChatTracking(sessionId);
    const windows = await processChatWindows(sessionId);
    return jsonResponse({ ...result, ...windows });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start chat tracking";
    return errorResponse(message, 500);
  }
}
