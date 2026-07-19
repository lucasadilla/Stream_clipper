import { NextRequest } from "next/server";
import { errorResponse, jsonResponse } from "@/lib/utils";
import { getBillingAccountIdFromRequest } from "@/services/billingService";
import {
  ensureSessionBillingAccess,
  SessionAccessError,
} from "@/services/sessionAccessService";
import {
  getFaceAnalysisJob,
  parseStoredFaceAnalysisResult,
} from "@/services/faceAnalysisService";

export const runtime = "nodejs";

/**
 * Poll a face-analysis job. Once completed, includes the classification,
 * candidates, recommendation, warnings and a representative frame URL for the
 * manual-adjust UI. Raw track points stay server-side except for candidates.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;
    const job = await getFaceAnalysisJob(jobId);
    if (!job) return errorResponse("Analysis job not found", 404);

    const billingAccountId = getBillingAccountIdFromRequest(request);
    try {
      await ensureSessionBillingAccess(job.streamSessionId, billingAccountId);
    } catch (err) {
      if (err instanceof SessionAccessError) {
        return errorResponse(err.message, err.status);
      }
      throw err;
    }

    const base = {
      id: job.id,
      status: job.status,
      progress: job.progress,
      errorMessage: job.errorMessage,
      classification: job.classification,
      confidence: job.confidence,
    };

    if (job.status !== "completed") {
      return jsonResponse({ job: base });
    }

    const result = parseStoredFaceAnalysisResult(job.resultJson);
    if (!result) {
      return jsonResponse({ job: base });
    }

    return jsonResponse({
      job: {
        ...base,
        sourceWidth: result.sourceWidth,
        sourceHeight: result.sourceHeight,
        primaryCandidate: result.primaryCandidate ?? null,
        alternativeCandidates: result.alternativeCandidates,
        recommendation: result.recommendation,
        warnings: result.warnings,
        frameUrl: result.frameStoragePath
          ? `/api/storage/${result.frameStoragePath.replace(/\\/g, "/")}?inline=1`
          : null,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load analysis";
    return errorResponse(message, 500);
  }
}
