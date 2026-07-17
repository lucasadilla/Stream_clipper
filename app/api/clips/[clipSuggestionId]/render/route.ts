import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { createRenderJobRecord } from "@/services/renderService";
import { errorResponse, jsonResponse } from "@/lib/utils";
import { parseRenderFormat } from "@/lib/renderFormat";
import { normalizeCaptionAppearance, type CaptionAppearance } from "@/lib/captionAppearance";
import { canRenderExport } from "@/services/usageService";
import { getBillingAccountIdFromRequest } from "@/services/billingService";
import {
  ensureSessionBillingAccess,
  SessionAccessError,
} from "@/services/sessionAccessService";
import { getPostHogClient } from "@/lib/posthog-server";
import {
  normalizeEditorState,
  sequenceDuration,
} from "@/lib/editorState";

interface ClientCaptionCue {
  startTimeSeconds: number;
  endTimeSeconds: number;
  text: string;
  words?: Array<{ start: number; end: number; word: string }>;
}

function parseCaptionWords(
  value: unknown
): Array<{ start: number; end: number; word: string }> | undefined {
  if (!Array.isArray(value)) return undefined;
  const words = value
    .slice(0, 200)
    .flatMap((word) => {
      if (!word || typeof word !== "object") return [];
      const raw = word as Record<string, unknown>;
      const start = raw.start;
      const end = raw.end;
      const text = typeof raw.word === "string" ? raw.word.trim() : "";
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
      return [{ start, end, word: text.slice(0, 80) }];
    });
  return words.length > 0 ? words : undefined;
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
      const words = parseCaptionWords(raw.words);
      return [
        {
          startTimeSeconds: start,
          endTimeSeconds: end,
          text: text.slice(0, 1000),
          ...(words ? { words } : {}),
        },
      ];
    });
}

export const runtime = "nodejs";
export const maxDuration = 60;

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
    const editorState = normalizeEditorState(
      (body as { editorState?: unknown }).editorState
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

    const outputDuration =
      editorState.segments.length > 0
        ? sequenceDuration(editorState.segments)
        : clip.endTimeSeconds - clip.startTimeSeconds;
    const usageGate = await canRenderExport(
      billingAccountId,
      1,
      outputDuration
    );
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
      editorState,
    };

    const jobId = await createRenderJobRecord({
      streamSessionId: clip.streamSessionId,
      clipSuggestionId: clip.id,
      sourceMediaId: sourceMedia?.id,
      layout: clip.suggestedLayout,
      includeCaptions,
      renderParams,
    });

    // Kick the worker without awaiting the cut. Awaiting blocked the HTTP
    // response (and progress polling) for the whole ffmpeg run, and hit
    // maxDuration before long cuts finished.
    void import("@/services/workerService")
      .then(({ runWorkerTick }) => runWorkerTick())
      .catch((err) => {
        console.warn("[render] worker nudge failed:", err);
      });

    if (billingAccountId) {
      getPostHogClient().capture({
        distinctId: billingAccountId,
        event: "clip_rendered",
        properties: {
          format: format,
          duration_seconds: outputDuration,
          segment_count: editorState.segments.length || 1,
          include_captions: includeCaptions,
        },
      });
    }
    return jsonResponse({
      jobId,
      status: "queued",
      downloadUrl: `/api/render-jobs/${jobId}/download`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Render failed";
    return errorResponse(message, 500);
  }
}
