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
import {
  getVerticalLayoutConfiguration,
  saveVerticalLayoutConfiguration,
} from "@/services/verticalLayoutService";

export const runtime = "nodejs";

async function authorizeClip(request: NextRequest, clipSuggestionId: string) {
  const clip = await prisma.clipSuggestion.findUnique({
    where: { id: clipSuggestionId },
    select: { id: true, streamSessionId: true },
  });
  if (!clip) throw new SessionAccessError("Clip not found", 404);
  const billingAccountId = getBillingAccountIdFromRequest(request);
  await ensureSessionBillingAccess(clip.streamSessionId, billingAccountId);
  return clip;
}

/** Load the saved vertical layout configuration for a clip. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ clipSuggestionId: string }> }
) {
  try {
    const { clipSuggestionId } = await params;
    const clip = await authorizeClip(request, clipSuggestionId);
    const config = await getVerticalLayoutConfiguration(clip.id);
    if (!config) return jsonResponse({ configuration: null });

    return jsonResponse({
      configuration: {
        layout: config.layout,
        faceAnalysisJobId: config.faceAnalysisJobId,
        faceSelection: {
          mode: config.faceSelectionMode,
          trackId: config.selectedTrackId ?? undefined,
          manualRect: config.manualFaceRect ?? undefined,
        },
        settings: config.settingsJson ?? {},
        updatedAt: config.updatedAt,
      },
    });
  } catch (error) {
    if (error instanceof SessionAccessError) {
      return errorResponse(error.message, error.status);
    }
    const message =
      error instanceof Error ? error.message : "Failed to load layout";
    return errorResponse(message, 500);
  }
}

/** Save the vertical layout configuration for a clip. */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ clipSuggestionId: string }> }
) {
  try {
    const { clipSuggestionId } = await params;
    const clip = await authorizeClip(request, clipSuggestionId);

    const body = verticalLayoutRequestSchema.parse(await request.json());
    const configurationId = await saveVerticalLayoutConfiguration({
      streamSessionId: clip.streamSessionId,
      clipSuggestionId: clip.id,
      request: body,
    });

    return jsonResponse({ configurationId });
  } catch (error) {
    if (error instanceof SessionAccessError) {
      return errorResponse(error.message, error.status);
    }
    if (error instanceof z.ZodError) {
      return errorResponse(error.errors[0]?.message ?? "Invalid layout", 400);
    }
    const message =
      error instanceof Error ? error.message : "Failed to save layout";
    return errorResponse(message, 500);
  }
}
