import { NextRequest } from "next/server";
import { z } from "zod";
import { errorResponse, jsonResponse } from "@/lib/utils";
import { getBillingAccountIdFromRequest } from "@/services/billingService";
import {
  ensureSessionBillingAccess,
  SessionAccessError,
} from "@/services/sessionAccessService";
import { requestFaceAnalysis } from "@/services/faceAnalysisService";

export const runtime = "nodejs";
export const maxDuration = 30;

const bodySchema = z.object({
  startSeconds: z.number().min(0),
  endSeconds: z.number().gt(0),
  sampleFps: z.number().min(1).max(8).optional(),
  clipSuggestionId: z.string().optional(),
  force: z.boolean().optional(),
});

/** Start (or reuse) a face analysis for a clip range within this session. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const billingAccountId = getBillingAccountIdFromRequest(request);
    try {
      await ensureSessionBillingAccess(sessionId, billingAccountId);
    } catch (err) {
      if (err instanceof SessionAccessError) {
        return errorResponse(err.message, err.status);
      }
      throw err;
    }

    const body = bodySchema.parse(await request.json());
    if (body.endSeconds <= body.startSeconds) {
      return errorResponse("endSeconds must be after startSeconds", 400);
    }

    const { jobId, status } = await requestFaceAnalysis({
      streamSessionId: sessionId,
      clipSuggestionId: body.clipSuggestionId,
      startSeconds: body.startSeconds,
      endSeconds: body.endSeconds,
      sampleFps: body.sampleFps,
      force: body.force,
    });

    return jsonResponse({ analysisJobId: jobId, status });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(error.errors[0]?.message ?? "Invalid request", 400);
    }
    const message =
      error instanceof Error ? error.message : "Failed to start face analysis";
    return errorResponse(message, 500);
  }
}
