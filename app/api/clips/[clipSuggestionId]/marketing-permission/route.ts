import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { errorResponse, jsonResponse } from "@/lib/utils";
import { getBillingAccountIdFromRequest } from "@/services/billingService";
import {
  ensureSessionBillingAccess,
  SessionAccessError,
} from "@/services/sessionAccessService";

const permissionSchema = z.object({ approved: z.boolean() });

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ clipSuggestionId: string }> }
) {
  try {
    const { clipSuggestionId } = await params;
    const { approved } = permissionSchema.parse(await request.json());
    const clip = await prisma.clipSuggestion.findUnique({
      where: { id: clipSuggestionId },
      select: { streamSessionId: true },
    });
    if (!clip) return errorResponse("Clip not found", 404);
    await ensureSessionBillingAccess(
      clip.streamSessionId,
      getBillingAccountIdFromRequest(request)
    );
    const updated = await prisma.clipSuggestion.update({
      where: { id: clipSuggestionId },
      data: {
        marketingApproved: approved,
        marketingApprovedAt: approved ? new Date() : null,
      },
      select: { id: true, marketingApproved: true, marketingApprovedAt: true },
    });
    return jsonResponse({ clip: updated });
  } catch (error) {
    if (error instanceof SessionAccessError) {
      return errorResponse(error.message, error.status);
    }
    if (error instanceof z.ZodError) {
      return errorResponse("Choose whether this clip may be featured", 400);
    }
    return errorResponse(
      error instanceof Error ? error.message : "Could not update permission",
      500
    );
  }
}
