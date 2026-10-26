import { NextRequest } from "next/server";
import { getLatestRenderOutputPath } from "@/services/clipShareService";
import { serveStorageFileInline } from "@/lib/storage";
import { errorResponse } from "@/lib/utils";
import { isLibraryPath } from "@/lib/clipLibrary";
import { ownedLibraryItem } from "@/services/clipLibraryService";
import { SessionAccessError } from "@/services/sessionAccessService";

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
    if (isLibraryPath(outputPath)) await ownedLibraryItem(request, clipSuggestionId);
    const response = await serveStorageFileInline(outputPath, request);
    if (isLibraryPath(outputPath)) { response.headers.set("Cache-Control", "private, no-store"); response.headers.set("Vary", "Cookie"); }
    return response;
  } catch (error) {
    if (error instanceof SessionAccessError) return errorResponse(error.message, error.status);
    const message =
      error instanceof Error ? error.message : "Failed to stream clip";
    return errorResponse(message, 500);
  }
}
