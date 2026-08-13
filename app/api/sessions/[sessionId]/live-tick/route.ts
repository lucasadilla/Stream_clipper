import { NextRequest } from "next/server";
import { runLivePipeline } from "@/services/livePipelineService";
import { errorResponse, jsonResponse } from "@/lib/utils";
import { getBillingAccountIdFromRequest } from "@/services/billingService";
import {
  ensureSessionBillingAccess,
  SessionAccessError,
} from "@/services/sessionAccessService";

export const runtime = "nodejs";
export const maxDuration = 300;

function sanitizeLiveTickResult(result: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(result)) {
    if (key === "recording" || key === "recordingStart") {
      const rec = value as { status?: string; recordedSeconds?: number } | null;
      out[key] = rec
        ? { status: rec.status, recordedSeconds: rec.recordedSeconds }
        : null;
      continue;
    }
    if (key === "chat") {
      const chat = value as { newMessages?: number; skipped?: boolean } | null;
      out[key] = chat
        ? {
            newMessages: chat.newMessages,
            skipped: chat.skipped,
          }
        : null;
      continue;
    }
    out[key] = value;
  }
  return out;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    await ensureSessionBillingAccess(
      sessionId,
      getBillingAccountIdFromRequest(request)
    );
    const result = await runLivePipeline(sessionId);
    return jsonResponse({
      success: true,
      ...sanitizeLiveTickResult(result),
    });
  } catch (error) {
    if (error instanceof SessionAccessError) {
      return errorResponse(error.message, error.status);
    }
    const message = error instanceof Error ? error.message : "Live pipeline failed";
    return errorResponse(message, 500);
  }
}
