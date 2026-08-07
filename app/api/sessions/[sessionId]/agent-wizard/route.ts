import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { errorResponse, jsonResponse, toJsonValue } from "@/lib/utils";
import { getBillingAccountIdFromRequest } from "@/services/billingService";
import {
  ensureSessionBillingAccess,
  SessionAccessError,
} from "@/services/sessionAccessService";
import {
  isAgentCadence,
  readAgentWizardState,
  withAgentWizardState,
  type AgentWizardState,
  type AgentWizardStep,
} from "@/lib/agentWizard";
import { isContentLookPresetId } from "@/lib/contentLookPresets";

export const runtime = "nodejs";

const bodySchema = z.object({
  step: z
    .enum(["transcribing", "pick", "look", "edit", "export", "done"])
    .optional(),
  selectedClipIds: z.array(z.string()).optional(),
  queueIndex: z.number().int().min(0).optional(),
  lookPreset: z.string().nullable().optional(),
  faceAnalysisJobId: z.string().nullable().optional(),
  includeCaptions: z.boolean().optional(),
  dynamicPunchInEnabled: z.boolean().optional(),
  suggestRequested: z.boolean().optional(),
  cadence: z
    .enum(["vod_batch", "live_now", "after_stream"])
    .nullable()
    .optional(),
  lastSuggestThroughSeconds: z.number().min(0).optional(),
});

export async function GET(
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
      select: { metadataJson: true },
    });
    if (!session) return errorResponse("Session not found", 404);
    return jsonResponse({ wizard: readAgentWizardState(session.metadataJson) });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load wizard";
    return errorResponse(message, 500);
  }
}

export async function PATCH(
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
      select: { metadataJson: true },
    });
    if (!session) return errorResponse("Session not found", 404);

    const body = bodySchema.parse(await request.json());
    const current = readAgentWizardState(session.metadataJson);
    const next: AgentWizardState = {
      ...current,
      ...(body.step ? { step: body.step as AgentWizardStep } : {}),
      ...(body.selectedClipIds ? { selectedClipIds: body.selectedClipIds } : {}),
      ...(body.queueIndex != null ? { queueIndex: body.queueIndex } : {}),
      ...(body.lookPreset !== undefined
        ? {
            lookPreset: isContentLookPresetId(body.lookPreset)
              ? body.lookPreset
              : null,
          }
        : {}),
      ...(body.faceAnalysisJobId !== undefined
        ? { faceAnalysisJobId: body.faceAnalysisJobId }
        : {}),
      ...(body.includeCaptions != null
        ? { includeCaptions: body.includeCaptions }
        : {}),
      ...(body.dynamicPunchInEnabled != null
        ? { dynamicPunchInEnabled: body.dynamicPunchInEnabled }
        : {}),
      ...(body.suggestRequested != null
        ? { suggestRequested: body.suggestRequested }
        : {}),
      ...(body.cadence !== undefined
        ? {
            cadence:
              body.cadence === null
                ? null
                : isAgentCadence(body.cadence)
                  ? body.cadence
                  : current.cadence,
          }
        : {}),
      ...(body.lastSuggestThroughSeconds != null
        ? { lastSuggestThroughSeconds: body.lastSuggestThroughSeconds }
        : {}),
    };

    await prisma.streamSession.update({
      where: { id: sessionId },
      data: {
        metadataJson: toJsonValue(
          withAgentWizardState(session.metadataJson, next)
        ),
      },
    });

    return jsonResponse({ wizard: next });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(error.errors[0]?.message ?? "Invalid input", 400);
    }
    const message =
      error instanceof Error ? error.message : "Failed to update wizard";
    return errorResponse(message, 500);
  }
}
