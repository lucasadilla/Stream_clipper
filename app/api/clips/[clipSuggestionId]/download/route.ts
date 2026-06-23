import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { serveStorageFile } from "@/lib/storage";
import { errorResponse } from "@/lib/utils";

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

    const job = await prisma.renderJob.findFirst({
      where: {
        clipSuggestionId,
        status: "completed",
        outputPath: { not: null },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!job?.outputPath) {
      return errorResponse("No rendered file for this clip yet. Click Render first.", 404);
    }

    const safeName = `${clip.title.slice(0, 40).replace(/[^\w\s-]/g, "") || "short"}.mp4`;
    return serveStorageFile(job.outputPath, safeName);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Download failed";
    return errorResponse(message, 500);
  }
}
