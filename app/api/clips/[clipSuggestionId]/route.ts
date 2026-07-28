import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getClipSharePayload } from "@/services/clipShareService";
import { updateClipSuggestion } from "@/services/suggestClipsService";
import { errorResponse, jsonResponse } from "@/lib/utils";
import { getBillingAccountIdFromRequest } from "@/services/billingService";
import {
  ensureSessionBillingAccess,
  SessionAccessError,
} from "@/services/sessionAccessService";
import { VERTICAL_LAYOUTS } from "@/lib/verticalLayout";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ clipSuggestionId: string }> }
) {
  try {
    const { clipSuggestionId } = await params;
    const clip = await getClipSharePayload(clipSuggestionId);
    if (!clip) return errorResponse("Clip not found", 404);
    return jsonResponse({ clip });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load clip";
    return errorResponse(message, 500);
  }
}

const patchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  startTimeSeconds: z.number().min(0).optional(),
  endTimeSeconds: z.number().min(0).optional(),
  reason: z.string().max(2000).optional(),
  suggestedLayout: z.enum(VERTICAL_LAYOUTS).optional(),
  status: z.enum(["suggested", "saved", "rendered", "rejected"]).optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ clipSuggestionId: string }> }
) {
  try {
    const { clipSuggestionId } = await params;
    const existing = await prisma.clipSuggestion.findUnique({
      where: { id: clipSuggestionId },
      select: { streamSessionId: true },
    });
    if (!existing) return errorResponse("Clip not found", 404);

    const billingAccountId = getBillingAccountIdFromRequest(request);
    try {
      await ensureSessionBillingAccess(
        existing.streamSessionId,
        billingAccountId
      );
    } catch (err) {
      if (err instanceof SessionAccessError) {
        return errorResponse(err.message, err.status);
      }
      throw err;
    }

    const body = patchSchema.parse(await request.json());
    const clip = await updateClipSuggestion(clipSuggestionId, body);
    return jsonResponse({ clip });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(error.errors[0]?.message ?? "Invalid input", 400);
    }
    const message =
      error instanceof Error ? error.message : "Failed to update clip";
    return errorResponse(message, 500);
  }
}
