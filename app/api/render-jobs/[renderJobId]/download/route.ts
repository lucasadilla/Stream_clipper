import { NextRequest } from "next/server";
import { getRenderJob } from "@/services/renderService";
import { serveStorageFile } from "@/lib/storage";
import { errorResponse } from "@/lib/utils";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ renderJobId: string }> }
) {
  try {
    const { renderJobId } = await params;
    const job = await getRenderJob(renderJobId);
    if (!job) return errorResponse("Render job not found", 404);
    if (job.status !== "completed" || !job.outputPath) {
      return errorResponse("Render not ready yet", 404);
    }

    return serveStorageFile(job.outputPath, `short-${renderJobId}.mp4`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Download failed";
    return errorResponse(message, 500);
  }
}
