import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { errorResponse, jsonResponse } from "@/lib/utils";
import { getBillingAccountIdFromRequest } from "@/services/billingService";
import {
  ensureSessionBillingAccess,
  SessionAccessError,
} from "@/services/sessionAccessService";

export async function POST(
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
    await ensureSessionBillingAccess(
      existing.streamSessionId,
      getBillingAccountIdFromRequest(request)
    );
    const clip = await prisma.clipSuggestion.update({
      where: { id: clipSuggestionId },
      data: { status: "saved" },
    });
    return jsonResponse({ clip });
  } catch (error) {
    if (error instanceof SessionAccessError) {
      return errorResponse(error.message, error.status);
    }
    const message = error instanceof Error ? error.message : "Failed to save clip";
    return errorResponse(message, 500);
  }
}
