import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { renderShort } from "@/services/renderService";
import { errorResponse, jsonResponse } from "@/lib/utils";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ clipSuggestionId: string }> }
) {
  try {
    const { clipSuggestionId } = await params;
    const body = await request.json().catch(() => ({}));
    const includeCaptions = (body as { includeCaptions?: boolean }).includeCaptions ?? false;

    const clip = await prisma.clipSuggestion.findUnique({
      where: { id: clipSuggestionId },
    });
    if (!clip) return errorResponse("Clip not found", 404);

    const sourceMedia = await prisma.sourceMedia.findFirst({
      where: { streamSessionId: clip.streamSessionId },
      orderBy: { createdAt: "desc" },
    });
    if (!sourceMedia) {
      return errorResponse(
        "Source video not ready. Wait for YouTube download to finish.",
        400
      );
    }

    const result = await renderShort({
      streamSessionId: clip.streamSessionId,
      sourceMediaId: sourceMedia.id,
      clipSuggestionId: clip.id,
      startTimeSeconds: clip.startTimeSeconds,
      endTimeSeconds: clip.endTimeSeconds,
      layout: clip.suggestedLayout as "center_crop",
      includeCaptions,
    });

    return jsonResponse(
      {
        ...result,
        downloadUrl: `/api/render-jobs/${result.jobId}/download`,
      },
      200
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Render failed";
    return errorResponse(message, 500);
  }
}
