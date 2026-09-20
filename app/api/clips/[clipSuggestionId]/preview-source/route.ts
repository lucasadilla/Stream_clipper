import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { errorResponse, jsonResponse } from "@/lib/utils";
import { getBillingAccountIdFromRequest } from "@/services/billingService";
import {
  ensureSessionBillingAccess,
  SessionAccessError,
} from "@/services/sessionAccessService";
import {
  ClipStudioPlaybackNotReadyError,
  ensureClipStudioPlayback,
} from "@/services/clipStudioPlaybackService";
import { MAX_CLIP_SECONDS, MIN_CLIP_SECONDS } from "@/lib/clipConstants";

export const runtime = "nodejs";
export const maxDuration = 90;

const previewRangeSchema = z
  .object({
    startTimeSeconds: z.number().min(0),
    endTimeSeconds: z.number().min(0),
  })
  .refine(
    (range) =>
      range.endTimeSeconds - range.startTimeSeconds >= MIN_CLIP_SECONDS &&
      range.endTimeSeconds - range.startTimeSeconds <= MAX_CLIP_SECONDS,
    "Invalid clip preview range"
  );

function storageUrl(relativePath: string, version: number): string {
  const encodedPath = relativePath
    .replace(/\\/g, "/")
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  return `/api/storage/${encodedPath}?inline=1&v=${version}`;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ clipSuggestionId: string }> }
) {
  try {
    const { clipSuggestionId } = await params;
    const clip = await prisma.clipSuggestion.findUnique({
      where: { id: clipSuggestionId },
      select: { streamSessionId: true },
    });
    if (!clip) return errorResponse("Clip not found", 404);

    await ensureSessionBillingAccess(
      clip.streamSessionId,
      getBillingAccountIdFromRequest(request)
    );
    const requestBody = await request.json().catch(() => null);
    const requestedRange = requestBody
      ? previewRangeSchema.safeParse(requestBody)
      : null;
    if (requestedRange && !requestedRange.success) {
      return errorResponse("Invalid clip preview range", 400);
    }
    const prepared = await ensureClipStudioPlayback(
      clipSuggestionId,
      requestedRange?.success ? requestedRange.data : undefined
    );
    return jsonResponse({
      playbackUrl: storageUrl(prepared.relativePath, prepared.version),
      timelineOffsetSeconds: prepared.timelineOffsetSeconds,
      durationSeconds: prepared.durationSeconds,
    });
  } catch (error) {
    if (error instanceof SessionAccessError) {
      return errorResponse(error.message, error.status);
    }
    if (error instanceof ClipStudioPlaybackNotReadyError) {
      return jsonResponse(
        {
          error: error.message,
          retryable: true,
          retryAfterMs: error.retryAfterMs,
        },
        409
      );
    }
    const message =
      error instanceof Error ? error.message : "Failed to prepare clip preview";
    return errorResponse(message, 500);
  }
}
