import { NextRequest } from "next/server";
import { z } from "zod";
import { createStreamSession } from "@/services/youtubeService";
import { listSessionsWithStorage } from "@/services/sessionCleanupService";
import { parseStreamUrl } from "@/lib/streamPlatform";
import { errorResponse, jsonResponse, parseRequestJson } from "@/lib/utils";

const createSessionSchema = z.object({
  streamUrl: z.string().min(1).optional(),
  youtubeUrl: z.string().min(1).optional(),
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
    const parsed = createSessionSchema.parse(body);
    const rawUrl = parsed.streamUrl ?? parsed.youtubeUrl;
    if (!rawUrl?.trim()) {
      return errorResponse("Please enter a stream URL", 400);
    }

    if (!parseStreamUrl(rawUrl)) {
      return errorResponse(
        "Unsupported URL. Use YouTube, Twitch (twitch.tv/channel or /videos/…), or Kick (kick.com/channel).",
        400
      );
    }

    const session = await createStreamSession(rawUrl);
    return jsonResponse(
      {
        session: {
          id: session.id,
          platform: session.platform,
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
