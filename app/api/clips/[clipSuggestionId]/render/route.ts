import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import {
  createRenderJobRecord,
  executeRenderJob,
  failRenderJob,
} from "@/services/renderService";
import { errorResponse, jsonResponse } from "@/lib/utils";
import { parseRenderFormat } from "@/lib/renderFormat";
import { normalizeCaptionAppearance, type CaptionAppearance } from "@/lib/captionAppearance";

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
    const format = parseRenderFormat((body as { format?: unknown }).format);
    const captionAppearance = normalizeCaptionAppearance(
      (body as { captionAppearance?: Partial<CaptionAppearance> }).captionAppearance
    );

    const clip = await prisma.clipSuggestion.findUnique({
      where: { id: clipSuggestionId },
    });
    if (!clip) return errorResponse("Clip not found", 404);

    const sourceMedia = await prisma.sourceMedia.findFirst({
      where: { streamSessionId: clip.streamSessionId },
      orderBy: { createdAt: "desc" },
    });

    const jobId = await createRenderJobRecord({
      streamSessionId: clip.streamSessionId,
      clipSuggestionId: clip.id,
      sourceMediaId: sourceMedia?.id,
      layout: clip.suggestedLayout,
      includeCaptions,
    });

    const renderParams = {
      streamSessionId: clip.streamSessionId,
      sourceMediaId: sourceMedia?.id,
      clipSuggestionId: clip.id,
      startTimeSeconds: clip.startTimeSeconds,
      endTimeSeconds: clip.endTimeSeconds,
      format,
      layout: clip.suggestedLayout as "center_crop",
      includeCaptions,
      captionAppearance,
    };

    try {
      await executeRenderJob(jobId, renderParams);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Render failed";
      await failRenderJob(jobId, message);
      return errorResponse(message, 500);
    }

    return jsonResponse({
      jobId,
      status: "completed",
      downloadUrl: `/api/render-jobs/${jobId}/download`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Render failed";
    return errorResponse(message, 500);
  }
}
