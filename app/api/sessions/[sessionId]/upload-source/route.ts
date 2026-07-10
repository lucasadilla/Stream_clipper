import { NextRequest } from "next/server";
import { saveSourceMedia } from "@/services/mediaService";
import { errorResponse, jsonResponse } from "@/lib/utils";
import { getBillingAccountIdFromRequest } from "@/services/billingService";
import { getPostHogClient } from "@/lib/posthog-server";

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
    const billingAccountId = getBillingAccountIdFromRequest(request);
    if (billingAccountId) {
      getPostHogClient().capture({
        distinctId: billingAccountId,
        event: "source_video_uploaded",
        properties: {
          session_id: sessionId,
          file_size_bytes: Number(sourceMedia.sizeBytes),
        },
      });
    }
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
