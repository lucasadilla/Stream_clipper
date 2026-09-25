import { NextRequest } from "next/server";
import { getRenderJob } from "@/services/renderService";
import { parseRenderJobLogs } from "@/lib/renderJobLogs";
import { parsePostRenderQualityReview } from "@/lib/postRenderCritic";
import { errorResponse, jsonResponse } from "@/lib/utils";
import { videoDownloadFilename } from "@/lib/downloadFilename";
import { getBillingAccountIdFromRequest } from "@/services/billingService";
import {
  ensureSessionBillingAccess,
  SessionAccessError,
} from "@/services/sessionAccessService";

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
    const logs = parseRenderJobLogs(job.logs);
    return jsonResponse({
      job: {
        id: job.id,
        status: job.status,
        progress: job.progress,
        outputPath: job.outputPath,
        errorMessage: job.errorMessage,
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        logs,
        stage: logs.at(-1)?.step ?? job.status,
        qualityReview: parsePostRenderQualityReview(job.qualityReview),
        downloadFilename: videoDownloadFilename(
          job.clipSuggestion?.title || job.streamSession.title
        ),
      },
    });
  } catch (error) {
    if (error instanceof SessionAccessError) {
      return errorResponse(error.message, error.status);
    }
    const message = error instanceof Error ? error.message : "Failed to fetch render job";
    return errorResponse(message, 500);
  }
}
