import { NextRequest } from "next/server";
import { saveSourceMedia } from "@/services/mediaService";
import { errorResponse, jsonResponse } from "@/lib/utils";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return errorResponse("No file provided", 400);
    }

    const sourceMedia = await saveSourceMedia(sessionId, file);
    return jsonResponse({
      sourceMedia: {
        ...sourceMedia,
        sizeBytes: sourceMedia.sizeBytes.toString(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed";
    return errorResponse(message, 500);
  }
}
