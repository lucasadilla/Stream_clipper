import { NextRequest } from "next/server";
import {
  saveSourceMedia,
  saveSourceMediaStream,
} from "@/services/mediaService";
import { errorResponse, jsonResponse } from "@/lib/utils";
import { getBillingAccountIdFromRequest } from "@/services/billingService";
import { getPostHogClient } from "@/lib/posthog-server";
import {
  ensureSessionBillingAccess,
  SessionAccessError,
} from "@/services/sessionAccessService";
import { getUsageSnapshot } from "@/services/usageService";
import { stopLiveRecording } from "@/services/liveRecordingService";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const billingAccountId = getBillingAccountIdFromRequest(request);
    await ensureSessionBillingAccess(sessionId, billingAccountId);
    const usage = await getUsageSnapshot(billingAccountId);
    await stopLiveRecording(sessionId, { skipSync: true }).catch(() => {});

    const encodedFileName = request.headers.get("x-file-name");
    let sourceMedia;
    if (encodedFileName && request.body) {
      let fileName = encodedFileName;
      try {
        fileName = decodeURIComponent(encodedFileName);
      } catch {
        // Keep the header value; file validation below still applies.
      }
      sourceMedia = await saveSourceMediaStream(
        sessionId,
        {
          name: fileName,
          type: request.headers.get("content-type") || "video/mp4",
          stream: request.body,
        },
        { maxDurationSeconds: usage.entitlements?.maxSourceDurationSeconds }
      );
    } else {
      const formData = await request.formData();
      const file = formData.get("file");
      if (!file || !(file instanceof File)) {
        return errorResponse("No file provided", 400);
      }
      sourceMedia = await saveSourceMedia(sessionId, file, {
        maxDurationSeconds: usage.entitlements?.maxSourceDurationSeconds,
      });
    }
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
    if (error instanceof SessionAccessError) {
      return errorResponse(error.message, error.status);
    }
    const message = error instanceof Error ? error.message : "Upload failed";
    const status = /too large/i.test(message)
      ? 413
      : /3 hours|invalid file|access is required/i.test(message)
        ? 400
        : 500;
    return errorResponse(message, status);
  }
}
