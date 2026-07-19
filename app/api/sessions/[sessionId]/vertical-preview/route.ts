import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { errorResponse, jsonResponse } from "@/lib/utils";
import { getBillingAccountIdFromRequest } from "@/services/billingService";
import {
  ensureSessionBillingAccess,
  SessionAccessError,
} from "@/services/sessionAccessService";
import { verticalLayoutRequestSchema } from "@/lib/verticalLayout";
import { createRenderJobRecord } from "@/services/renderService";
import {
  normalizeCaptionAppearance,
  type CaptionAppearance,
} from "@/lib/captionAppearance";

export const runtime = "nodejs";
export const maxDuration = 30;

const bodySchema = z.object({
  startSeconds: z.number().min(0),
  endSeconds: z.number().gt(0),
  verticalLayout: verticalLayoutRequestSchema,
  includeCaptions: z.boolean().optional(),
  captionAppearance: z.record(z.unknown()).optional(),
  captionCues: z
    .array(
      z.object({
        startTimeSeconds: z.number(),
        endTimeSeconds: z.number(),
        text: z.string().max(1000),
        words: z
          .array(
            z.object({ start: z.number(), end: z.number(), word: z.string().max(80) })
          )
          .max(200)
          .optional(),
      })
    )
    .max(200)
    .optional(),
});

const MAX_CONCURRENT_PREVIEWS_PER_SESSION = 2;

/**
 * Render a ~5 second, 360×640 preview of the selected vertical layout. Uses
 * the exact same layout resolution and filter builders as the final render.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const billingAccountId = getBillingAccountIdFromRequest(request);
    try {
      await ensureSessionBillingAccess(sessionId, billingAccountId);
    } catch (err) {
      if (err instanceof SessionAccessError) {
        return errorResponse(err.message, err.status);
      }
      throw err;
    }

    const body = bodySchema.parse(await request.json());
    if (body.endSeconds <= body.startSeconds) {
      return errorResponse("endSeconds must be after startSeconds", 400);
    }

    const activePreviews = await prisma.renderJob.count({
      where: {
        streamSessionId: sessionId,
        status: { in: ["queued", "processing"] },
        params: { path: ["preview"], equals: true },
      },
    });
    if (activePreviews >= MAX_CONCURRENT_PREVIEWS_PER_SESSION) {
      return errorResponse(
        "A preview is already rendering. Wait for it to finish.",
        429
      );
    }

    const jobId = await createRenderJobRecord({
      streamSessionId: sessionId,
      layout: body.verticalLayout.layout,
      includeCaptions: body.includeCaptions ?? false,
      maxAttempts: 1,
      renderParams: {
        streamSessionId: sessionId,
        startTimeSeconds: body.startSeconds,
        endTimeSeconds: body.endSeconds,
        format: "vertical",
        layout: "center_crop",
        includeCaptions: body.includeCaptions ?? false,
        captionAppearance: normalizeCaptionAppearance(
          body.captionAppearance as Partial<CaptionAppearance> | undefined
        ),
        captionCues: body.captionCues,
        verticalLayout: body.verticalLayout,
        preview: true,
      },
    });

    void import("@/services/workerService")
      .then(({ runWorkerTick }) => runWorkerTick())
      .catch(() => {});

    return jsonResponse({ jobId, status: "queued" });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(error.errors[0]?.message ?? "Invalid request", 400);
    }
    const message =
      error instanceof Error ? error.message : "Failed to start preview";
    return errorResponse(message, 500);
  }
}
