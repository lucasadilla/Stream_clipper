import { NextRequest } from "next/server";
import { getLatestRenderOutputPath } from "@/services/clipShareService";
import { serveStorageFileInline } from "@/lib/storage";
import { errorResponse } from "@/lib/utils";

export const runtime = "nodejs";

/** Inline video stream for share page preview (supports Range requests). */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ clipSuggestionId: string }> }
) {
  try {
    const { clipSuggestionId } = await params;
    const outputPath = await getLatestRenderOutputPath(clipSuggestionId);
    if (!outputPath) {
      return errorResponse("No rendered video for this clip yet", 404);
    }
    return serveStorageFileInline(outputPath, request);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to stream clip";
    return errorResponse(message, 500);
  }
}
