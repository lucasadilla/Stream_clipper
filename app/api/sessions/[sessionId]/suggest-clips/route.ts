import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { autoSuggestClips } from "@/services/suggestClipsService";
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

    void ensureClipSuggestionThumbnails(
      sessionId,
      clips.map((c) => c.id)
    ).catch(() => {});

    const wizard = {
      ...currentWizard,
      suggestRequested: true,
      lastSuggestThroughSeconds:
        body.throughSeconds != null
          ? body.throughSeconds
          : currentWizard.lastSuggestThroughSeconds,
      step:
        clips.length > 0
          ? ("pick" as const)
          : currentWizard.step === "transcribing"
            ? ("pick" as const)
            : // Stay on look/edit/export if mid-wizard; otherwise pick
              currentWizard.step === "look" ||
                currentWizard.step === "edit" ||
                currentWizard.step === "export" ||
                currentWizard.step === "done"
              ? currentWizard.step
              : ("pick" as const),
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
