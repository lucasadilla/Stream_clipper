import { NextRequest } from "next/server";
import { getRenderJob } from "@/services/renderService";
import { parseRenderJobLogs } from "@/lib/renderJobLogs";
import { errorResponse, jsonResponse } from "@/lib/utils";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ renderJobId: string }> }
) {
  try {
    const { renderJobId } = await params;
    const job = await getRenderJob(renderJobId);
    if (!job) return errorResponse("Render job not found", 404);
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
        logs: parseRenderJobLogs(job.logs),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch render job";
    return errorResponse(message, 500);
  }
}
