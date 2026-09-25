import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { serveStorageFile } from "@/lib/storage";
import { errorResponse } from "@/lib/utils";
import { getLatestCompletedFinalRenderJob } from "@/services/renderSelectionService";
import { failRenderJob } from "@/services/renderService";
import { inspectDeliverableVideo } from "@/services/deliverableVideoService";
import { videoDownloadFilename } from "@/lib/downloadFilename";
import { getBillingAccountIdFromRequest } from "@/services/billingService";
import {
  ensureSessionBillingAccess,
  SessionAccessError,
} from "@/services/sessionAccessService";
import { getPostHogClient } from "@/lib/posthog-server";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ clipSuggestionId: string }> }
) {
  try {
    const { clipSuggestionId } = await params;

    const clip = await prisma.clipSuggestion.findUnique({
      where: { id: clipSuggestionId },
    });
    if (!clip) return errorResponse("Clip not found", 404);
    await ensureSessionBillingAccess(
      clip.streamSessionId,
      getBillingAccountIdFromRequest(request)
    );

    const job = await getLatestCompletedFinalRenderJob(clipSuggestionId);

    if (!job?.outputPath) {
      return errorResponse("No rendered file for this clip yet. Click Render first.", 404);
    }

    const inspection = await inspectDeliverableVideo(job.outputPath, {
      relativeToStorage: true,
    });
    if (!inspection.ok) {
      const message = `${inspection.reason ?? "Rendered file is unavailable"} Render the clip again.`;
      await failRenderJob(job.id, message);
      return errorResponse(message, inspection.sizeBytes === 0 ? 404 : 409);
    }

    const billingAccountId = getBillingAccountIdFromRequest(request);
    if (billingAccountId) {
      getPostHogClient().capture({
        distinctId: billingAccountId,
        event: "first_clip_downloaded",
        properties: {
          clip_id: clip.id,
          $insert_id: `${billingAccountId}:first_clip_downloaded`,
        },
      });
    }

    return serveStorageFile(job.outputPath, videoDownloadFilename(clip.title), request);
  } catch (error) {
    if (error instanceof SessionAccessError) {
      return errorResponse(error.message, error.status);
    }
    const message = error instanceof Error ? error.message : "Download failed";
    return errorResponse(message, 500);
  }
}
