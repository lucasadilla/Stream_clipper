import { NextRequest } from "next/server";
import { acquireSourceMedia } from "@/services/liveRecordingService";
import { errorResponse, jsonResponse } from "@/lib/utils";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const result = await acquireSourceMedia(sessionId);
    const media = result.sourceMedia;
    return jsonResponse({
      ...result,
      sourceMedia: media
        ? { ...media, sizeBytes: media.sizeBytes.toString() }
        : null,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "YouTube download failed";
    return errorResponse(message, 500);
  }
}
