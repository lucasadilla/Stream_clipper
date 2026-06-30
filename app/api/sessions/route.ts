import { NextRequest } from "next/server";
import { z } from "zod";
import { createStreamSession } from "@/services/youtubeService";
import { listSessionsWithStorage } from "@/services/sessionCleanupService";
import { extractYouTubeVideoId, normalizeUserYoutubeUrl } from "@/lib/youtube";
import { errorResponse, jsonResponse, parseRequestJson } from "@/lib/utils";

const createSessionSchema = z.object({
  youtubeUrl: z.string().min(1, "Please enter a YouTube URL"),
});

export async function GET(request: NextRequest) {
  try {
    const limit = Math.min(
      50,
      parseInt(request.nextUrl.searchParams.get("limit") ?? "20", 10) || 20
    );
    const sessions = await listSessionsWithStorage(limit);
    return jsonResponse({ sessions });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to list sessions";
    return errorResponse(message, 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await parseRequestJson(request);
    if (!body) return errorResponse("Request body required", 400);
    const { youtubeUrl: rawUrl } = createSessionSchema.parse(body);
    const youtubeUrl = normalizeUserYoutubeUrl(rawUrl);
    if (!extractYouTubeVideoId(youtubeUrl)) {
      return errorResponse(
        "Invalid YouTube URL. Use youtube.com/watch?v=, youtu.be/, or youtube.com/live/",
        400
      );
    }
    const session = await createStreamSession(youtubeUrl);
    return jsonResponse(
      {
        session: {
          id: session.id,
          youtubeVideoId: session.youtubeVideoId,
          title: session.title,
          liveStatus: session.liveStatus,
        },
      },
      201
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(error.errors[0]?.message ?? "Invalid input", 400);
    }
    const message = error instanceof Error ? error.message : "Failed to create session";
    return errorResponse(message, 500);
  }
}
