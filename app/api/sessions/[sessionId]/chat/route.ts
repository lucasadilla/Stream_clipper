import { NextRequest } from "next/server";
import { getChatMessages } from "@/services/chatIngestionService";
import { errorResponse, jsonResponse } from "@/lib/utils";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const limit = parseInt(request.nextUrl.searchParams.get("limit") ?? "200", 10);
    const messages = await getChatMessages(sessionId, limit);
    return jsonResponse({ messages });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch chat";
    return errorResponse(message, 500);
  }
}
