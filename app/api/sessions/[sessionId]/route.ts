import { NextRequest } from "next/server";
import { getStreamSession } from "@/services/youtubeService";
import { errorResponse, jsonResponse } from "@/lib/utils";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const session = await getStreamSession(sessionId);
    if (!session) return errorResponse("Session not found", 404);

    return jsonResponse({
      session: {
        ...session,
        sourceMedia: session.sourceMedia.map((m) => ({
          ...m,
          sizeBytes: m.sizeBytes.toString(),
        })),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch session";
    return errorResponse(message, 500);
  }
}
