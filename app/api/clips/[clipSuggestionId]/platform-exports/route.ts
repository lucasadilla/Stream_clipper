import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { isPlatformKey } from "@/lib/platforms/presets";
import type {
  CreatePlatformExportPackInput,
  PlatformCopy,
  XQuoteLayout,
} from "@/lib/platforms/types";
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

function nullableText(value: unknown, max: number): string | null {
  return typeof value === "string" ? value.trim().slice(0, max) || null : null;
}

function textList(value: unknown, maxItems: number, maxLength: number): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().slice(0, maxLength))
        .filter(Boolean)
        .slice(0, maxItems)
    : [];
}

function copyOverride(value: unknown): PlatformCopy | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  return {
    title: nullableText(raw.title, 120),
    caption: nullableText(raw.caption, 5000),
    postText: nullableText(raw.postText, 5000),
    description: nullableText(raw.description, 10000),
    hashtags: textList(raw.hashtags, 30, 60),
    tags: textList(raw.tags, 50, 100),
    quoteText: nullableText(raw.quoteText, 240),
    thumbnailText: nullableText(raw.thumbnailText, 100),
    pinnedComment: nullableText(raw.pinnedComment, 2000),
  };
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
  const copyOverrides: CreatePlatformExportPackInput["copyOverrides"] = {};
  if (raw.copyOverrides && typeof raw.copyOverrides === "object") {
    for (const [key, value] of Object.entries(raw.copyOverrides)) {
      if (!isPlatformKey(key)) continue;
      const parsed = copyOverride(value);
      if (parsed) copyOverrides[key] = parsed;
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
    copyOverrides,
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
      1,
      fullClip ? fullClip.endTimeSeconds - fullClip.startTimeSeconds : undefined,
      clipSuggestionId
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
