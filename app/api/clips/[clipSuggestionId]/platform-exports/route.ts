import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { isPlatformKey } from "@/lib/platforms/presets";
import type { CreatePlatformExportPackInput, XQuoteLayout } from "@/lib/platforms/types";
import { errorResponse, jsonResponse } from "@/lib/utils";
import { getBillingAccountIdFromRequest } from "@/services/billingService";
import {
  createPlatformExportPack,
  serializePlatformExportPack,
} from "@/services/platformExportService";
import {
  ensureSessionBillingAccess,
  SessionAccessError,
} from "@/services/sessionAccessService";
import { canRenderExport } from "@/services/usageService";

export const runtime = "nodejs";
export const maxDuration = 60;

function quoteLayout(value: unknown): XQuoteLayout {
  return value === "quote_bottom" || value === "overlay" ? value : "quote_top";
}

function parseInput(value: unknown): CreatePlatformExportPackInput {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const platforms = Array.isArray(raw.platforms)
    ? raw.platforms.filter(isPlatformKey)
    : [];
  const outputOptions: CreatePlatformExportPackInput["outputOptions"] = {};
  if (raw.outputOptions && typeof raw.outputOptions === "object") {
    for (const [key, outputId] of Object.entries(raw.outputOptions)) {
      if (isPlatformKey(key) && typeof outputId === "string") outputOptions[key] = outputId;
    }
  }
  return {
    platforms,
    includeCaptions: raw.includeCaptions !== false,
    burnSubtitles: raw.burnSubtitles !== false,
    generateCopy: raw.generateCopy !== false,
    xQuoteCard: raw.xQuoteCard === true,
    xQuoteLayout: quoteLayout(raw.xQuoteLayout),
    outputOptions,
  };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ clipSuggestionId: string }> }
) {
  try {
    const { clipSuggestionId } = await params;
    const input = parseInput(await request.json().catch(() => ({})));
    if (input.platforms.length === 0) return errorResponse("Choose at least one platform", 400);

    const clip = await prisma.clipSuggestion.findUnique({
      where: { id: clipSuggestionId },
      select: { streamSessionId: true },
    });
    if (!clip) return errorResponse("Clip not found", 404);

    const billingAccountId = getBillingAccountIdFromRequest(request);
    await ensureSessionBillingAccess(clip.streamSessionId, billingAccountId);
    const fullClip = await prisma.clipSuggestion.findUnique({
      where: { id: clipSuggestionId },
      select: { startTimeSeconds: true, endTimeSeconds: true },
    });
    const gate = await canRenderExport(
      billingAccountId,
      input.platforms.length,
      fullClip ? fullClip.endTimeSeconds - fullClip.startTimeSeconds : undefined
    );
    if (!gate.allowed) {
      return errorResponse(gate.message ?? "Plan limit reached", gate.status ?? 402);
    }

    const pack = await createPlatformExportPack(clipSuggestionId, input);
    void import("@/services/workerService")
      .then(({ runWorkerTick }) => runWorkerTick())
      .catch(() => {});
    return jsonResponse({ pack: serializePlatformExportPack(pack) }, 202);
  } catch (error) {
    if (error instanceof SessionAccessError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to create exports", 500);
  }
}
