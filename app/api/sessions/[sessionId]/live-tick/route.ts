import { NextRequest } from "next/server";
import { runLivePipeline } from "@/services/livePipelineService";
import { errorResponse, jsonResponse } from "@/lib/utils";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const result = await runLivePipeline(sessionId);
    return jsonResponse({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Live pipeline failed";
    return errorResponse(message, 500);
  }
}
