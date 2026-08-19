import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import {
  isPlatformKey,
  PLATFORM_KEYS,
} from "@/lib/platforms/presets";
import type { PlatformKey } from "@/lib/platforms/types";
import { errorResponse, jsonResponse } from "@/lib/utils";
import { getBillingAccountIdFromRequest } from "@/services/billingService";
import {
  ensureSessionBillingAccess,
  SessionAccessError,
} from "@/services/sessionAccessService";
import { generatePlatformCopiesForClip } from "@/services/platformCopyService";

export const runtime = "nodejs";
export const maxDuration = 60;

function requestedPlatforms(value: unknown): PlatformKey[] {
  if (!value || typeof value !== "object") return PLATFORM_KEYS;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.platforms)) return PLATFORM_KEYS;
  const platforms = [...new Set(raw.platforms.filter(isPlatformKey))];
  return platforms.length > 0 ? platforms : PLATFORM_KEYS;
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
    const platforms = requestedPlatforms(await request.json().catch(() => ({})));
    const copies = await generatePlatformCopiesForClip(
      clipSuggestionId,
      platforms
    );
    return jsonResponse({ copies });
  } catch (error) {
    if (error instanceof SessionAccessError) {
      return errorResponse(error.message, error.status);
    }
    return errorResponse(
      error instanceof Error ? error.message : "Failed to generate platform copy",
      500
    );
  }
}
