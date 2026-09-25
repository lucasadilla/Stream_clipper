import { NextRequest } from "next/server";
import { getRenderJob, failRenderJob } from "@/services/renderService";
import { serveStorageFile } from "@/lib/storage";
import { errorResponse } from "@/lib/utils";
import { inspectDeliverableVideo } from "@/services/deliverableVideoService";
import { videoDownloadFilename } from "@/lib/downloadFilename";
import { getBillingAccountIdFromRequest } from "@/services/billingService";
import {
  ensureSessionBillingAccess,
  SessionAccessError,
} from "@/services/sessionAccessService";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ renderJobId: string }> }
) {
  try {
    const { renderJobId } = await params;
    const job = await getRenderJob(renderJobId);
    if (!job) return errorResponse("Render job not found", 404);
    await ensureSessionBillingAccess(
      job.streamSessionId,
      getBillingAccountIdFromRequest(request)
    );
    if (job.status !== "completed" || !job.outputPath) {
      return errorResponse("Render not ready yet", 404);
    }

    const inspection = await inspectDeliverableVideo(job.outputPath, {
      relativeToStorage: true,
    });
    if (!inspection.ok) {
      const message = `${inspection.reason ?? "Rendered file is unavailable"} Render the clip again.`;
      await failRenderJob(renderJobId, message);
      return errorResponse(message, inspection.sizeBytes === 0 ? 404 : 409);
    }

    return serveStorageFile(
      job.outputPath,
      videoDownloadFilename(
        job.clipSuggestion?.title || job.streamSession.title
      ),
      request
    );
  } catch (error) {
    if (error instanceof SessionAccessError) {
      return errorResponse(error.message, error.status);
    }
    const message = error instanceof Error ? error.message : "Download failed";
    return errorResponse(message, 500);
  }
}
