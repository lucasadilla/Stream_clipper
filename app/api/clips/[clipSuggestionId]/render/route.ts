import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import {
  createRenderJobRecord,
  executeRenderJob,
  failRenderJob,
} from "@/services/renderService";
import { errorResponse, jsonResponse } from "@/lib/utils";
import { parseRenderFormat } from "@/lib/renderFormat";
import { formatFfmpegProcessError } from "@/lib/ffmpeg";
import { normalizeCaptionAppearance, type CaptionAppearance } from "@/lib/captionAppearance";
import { canRenderExport } from "@/services/usageService";
import { getBillingAccountIdFromRequest } from "@/services/billingService";
import {
  ensureSessionBillingAccess,
  SessionAccessError,
} from "@/services/sessionAccessService";

interface ClientCaptionCue {
  startTimeSeconds: number;
  endTimeSeconds: number;
  text: string;
}

function parseCaptionCues(value: unknown): ClientCaptionCue[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .slice(0, 500)
    .flatMap((cue) => {
      if (!cue || typeof cue !== "object") return [];
      const raw = cue as Record<string, unknown>;
      const start = raw.startTimeSeconds;
      const end = raw.endTimeSeconds;
      const text = typeof raw.text === "string" ? raw.text.trim() : "";
      if (
        typeof start !== "number" ||
        !Number.isFinite(start) ||
        typeof end !== "number" ||
        !Number.isFinite(end) ||
        end <= start ||
        !text
      ) {
        return [];
      }
      return [{ startTimeSeconds: start, endTimeSeconds: end, text: text.slice(0, 1000) }];
    });
}

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
    const captionCues = parseCaptionCues(
      (body as { captionCues?: unknown }).captionCues
    );
    const format = parseRenderFormat((body as { format?: unknown }).format);
    const captionAppearance = normalizeCaptionAppearance(
      (body as { captionAppearance?: Partial<CaptionAppearance> }).captionAppearance
    );

    const clip = await prisma.clipSuggestion.findUnique({
      where: { id: clipSuggestionId },
      include: { streamSession: { select: { id: true, billingAccountId: true } } },
    });
    if (!clip) return errorResponse("Clip not found", 404);

    const billingAccountId = getBillingAccountIdFromRequest(request);
    try {
      await ensureSessionBillingAccess(clip.streamSessionId, billingAccountId);
    } catch (err) {
      if (err instanceof SessionAccessError) {
        return errorResponse(err.message, err.status);
      }
      throw err;
    }

    const usageGate = await canRenderExport(billingAccountId);
    if (!usageGate.allowed) {
      return errorResponse(
        usageGate.message ?? "Plan limit reached",
        usageGate.status ?? 402
      );
    }

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
      captionCues,
    };

    try {
      await executeRenderJob(jobId, renderParams);
    } catch (error) {
      const message = formatFfmpegProcessError(error);
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
