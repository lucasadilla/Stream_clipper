import { NextRequest } from "next/server";
import { getRenderJob } from "@/services/renderService";
import { errorResponse, jsonResponse } from "@/lib/utils";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ renderJobId: string }> }
) {
  try {
    const { renderJobId } = await params;
    const job = await getRenderJob(renderJobId);
    if (!job) return errorResponse("Render job not found", 404);
    return jsonResponse({ job });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch render job";
    return errorResponse(message, 500);
  }
}
