import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  autoSuggestClips,
  CLIP_SUGGESTION_VERSION,
} from "@/services/suggestClipsService";
import { errorResponse, jsonResponse, toJsonValue } from "@/lib/utils";
import { getBillingAccountIdFromRequest } from "@/services/billingService";
import {
  ensureSessionBillingAccess,
  SessionAccessError,
} from "@/services/sessionAccessService";
import {
  DEFAULT_AGENT_WIZARD_STATE,
  LIVE_NOW_SUGGESTION_CAP,
  readAgentWizardState,
  withAgentWizardState,
} from "@/lib/agentWizard";
import { ensureClipSuggestionThumbnails } from "@/services/clipThumbnailService";
import { prepareSuggestedClips } from "@/services/clipAutoPrepareService";
import { reclaimEphemeralStorage } from "@/services/storageReclaimService";

export const runtime = "nodejs";
export const maxDuration = 120;

const bodySchema = z.object({
  limit: z.number().int().min(1).max(20).optional().default(10),
  /** Request additional clips beyond existing non-rejected ones. */
  extra: z.number().int().min(0).max(10).optional().default(0),
  /** Transcript frontier watermark for live_now rolling. */
  throughSeconds: z.number().min(0).optional(),
  /** Soft cap for live rolling suggestions. */
  cap: z.number().int().min(1).max(40).optional(),
});

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

    const session = await prisma.streamSession.findUnique({
      where: { id: sessionId },
      select: { id: true, metadataJson: true },
    });
    if (!session) return errorResponse("Session not found", 404);

    const body = bodySchema.parse(await request.json().catch(() => ({})));
    const currentWizard = readAgentWizardState(session.metadataJson);
    const cap =
      body.cap ??
      (currentWizard.cadence === "live_now" ? LIVE_NOW_SUGGESTION_CAP : 40);

    // Refresh only untouched suggestions made before title/evidence grounding.
    // Selected, saved, and rendered clips remain exactly as the creator left them.
    const suggestedRows = await prisma.clipSuggestion.findMany({
      where: { streamSessionId: sessionId, status: "suggested" },
      select: { id: true, rawAiJson: true },
    });
    const legacyIds = suggestedRows.flatMap((row) => {
      const raw = row.rawAiJson;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
      const record = raw as {
        source?: unknown;
        suggestionVersion?: unknown;
      };
      return record.source === "auto_suggest" &&
        record.suggestionVersion !== CLIP_SUGGESTION_VERSION
        ? [row.id]
        : [];
    });
    if (legacyIds.length > 0) {
      await prisma.$transaction([
        prisma.faceAnalysisJob.deleteMany({
          where: { clipSuggestionId: { in: legacyIds } },
        }),
        prisma.clipSuggestion.deleteMany({ where: { id: { in: legacyIds } } }),
      ]);
    }

    const existingCount = await prisma.clipSuggestion.count({
      where: { streamSessionId: sessionId, status: { not: "rejected" } },
    });

    let result: Awaited<ReturnType<typeof autoSuggestClips>> = {
      created: 0,
      clips: [],
    };

    if (existingCount < cap) {
      if (body.extra > 0) {
        const room = Math.max(0, cap - existingCount);
        result = await autoSuggestClips(sessionId, 0, {
          extraLimit: Math.min(body.extra, room),
        });
      } else if (existingCount >= body.limit) {
        result = { created: 0, clips: [] };
      } else {
        result = await autoSuggestClips(
          sessionId,
          Math.min(body.limit - existingCount, cap - existingCount)
        );
      }
    }

    const clips = await prisma.clipSuggestion.findMany({
      where: { streamSessionId: sessionId, status: { not: "rejected" } },
      orderBy: [{ confidence: "desc" }, { createdAt: "desc" }],
      take: 40,
    });

    // Clip cards use a lazy thumbnail endpoint, so never hold the first picks
    // behind a batch of FFmpeg seeks. Warm the files in the background.
    const thumbIds = [
      ...result.clips.map((c) => c.id),
      ...clips.map((c) => c.id),
    ].filter((id, i, arr) => arr.indexOf(id) === i);
    void (async () => {
      await reclaimEphemeralStorage({
        keepSessionId: sessionId,
        pruneSessionSegments: true,
      });
      await ensureClipSuggestionThumbnails(sessionId, thumbIds);

    // Auto-compose vertical layouts (face detection → recommended crop).
    // Fire-and-forget so the pick grid isn't blocked.
      await prepareSuggestedClips(
        sessionId,
        clips.slice(0, 3).map((c) => ({
          id: c.id,
          startTimeSeconds: c.startTimeSeconds,
          endTimeSeconds: c.endTimeSeconds,
        }))
      );
    })().catch((error) => {
      console.warn("[suggest-clips] asset warmup failed", error);
    });

    const hasClips = clips.length > 0;
    const isLaterStep =
      currentWizard.step === "look" ||
      currentWizard.step === "edit" ||
      currentWizard.step === "export" ||
      currentWizard.step === "done";
    const wizard = {
      ...currentWizard,
      suggestRequested: hasClips,
      lastSuggestThroughSeconds:
        body.throughSeconds != null
          ? body.throughSeconds
          : currentWizard.lastSuggestThroughSeconds,
      step: hasClips
        ? ("pick" as const)
        : isLaterStep
          ? currentWizard.step
          : ("transcribing" as const),
    };

    // Don't yank the user out of look/edit/export when rolling live suggestions arrive.
    if (
      body.extra > 0 &&
      (currentWizard.step === "look" ||
        currentWizard.step === "edit" ||
        currentWizard.step === "export" ||
        currentWizard.step === "done")
    ) {
      wizard.step = currentWizard.step;
    }

    await prisma.streamSession.update({
      where: { id: sessionId },
      data: {
        metadataJson: toJsonValue(
          withAgentWizardState(session.metadataJson, {
            ...DEFAULT_AGENT_WIZARD_STATE,
            ...wizard,
          })
        ),
      },
    });

    return jsonResponse({
      created: result.created,
      clips,
      wizard,
      ...(hasClips
        ? {}
        : {
            emptyReason:
              "The transcript finished, but it did not contain usable speech for clip suggestions.",
          }),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(error.errors[0]?.message ?? "Invalid input", 400);
    }
    const message =
      error instanceof Error ? error.message : "Failed to suggest clips";
    return errorResponse(message, 500);
  }
}
