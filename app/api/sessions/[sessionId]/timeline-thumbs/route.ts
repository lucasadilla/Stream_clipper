import { NextRequest } from "next/server";
import { getTimelineThumbnails } from "@/services/timelineThumbnailService";
import { errorResponse, jsonResponse } from "@/lib/utils";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const thumbnails = await getTimelineThumbnails(sessionId);
    return jsonResponse({ thumbnails });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load thumbnails";
    return errorResponse(message, 500);
  }
}
