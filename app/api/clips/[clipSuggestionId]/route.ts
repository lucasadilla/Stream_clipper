import { NextRequest } from "next/server";
import { getClipSharePayload } from "@/services/clipShareService";
import { errorResponse, jsonResponse } from "@/lib/utils";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ clipSuggestionId: string }> }
) {
  try {
    const { clipSuggestionId } = await params;
    const clip = await getClipSharePayload(clipSuggestionId);
    if (!clip) return errorResponse("Clip not found", 404);
    return jsonResponse({ clip });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load clip";
    return errorResponse(message, 500);
  }
}
