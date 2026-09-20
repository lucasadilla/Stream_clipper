import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { serveStorageFile } from "@/lib/storage";
import { errorResponse } from "@/lib/utils";
import { getLatestCompletedFinalRenderJob } from "@/services/renderSelectionService";
import { failRenderJob } from "@/services/renderService";
import { inspectDeliverableVideo } from "@/services/deliverableVideoService";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ clipSuggestionId: string }> }
) {
  try {
    const { clipSuggestionId } = await params;

    const clip = await prisma.clipSuggestion.findUnique({
      where: { id: clipSuggestionId },
    });
    if (!clip) return errorResponse("Clip not found", 404);

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

    const safeName = `${clip.title.slice(0, 40).replace(/[^\w\s-]/g, "") || "short"}.mp4`;
    return serveStorageFile(job.outputPath, safeName);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Download failed";
    return errorResponse(message, 500);
  }
}
