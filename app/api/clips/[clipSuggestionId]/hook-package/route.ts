import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { MIN_CLIP_SECONDS } from "@/lib/clipConstants";
import {
  buildLocalClipPackage,
  clipPackageSchema,
  reviewHookCandidate,
} from "@/lib/hookIntelligence";
import { getHookEnginePolicy } from "@/lib/aiModelPolicy";
import {
  getClipContentProfile,
  inferClipContentType,
  type ClipContentType,
} from "@/lib/clipContentProfile";
import {
  applyVisualContextToNarrativePlan,
  planNarrativeClip,
} from "@/lib/narrativeBeats";
import {
  sanitizeStructuredVisualContext,
  type StructuredVisualContext,
} from "@/lib/visualAnalysis";
import { getTranscriptChunksForRange } from "@/services/transcriptService";
import { getBillingAccountIdFromRequest } from "@/services/billingService";
import {
  ensureSessionBillingAccess,
  SessionAccessError,
} from "@/services/sessionAccessService";
import { errorResponse, jsonResponse, toJsonValue } from "@/lib/utils";

export const runtime = "nodejs";

const selectionSchema = z
  .object({
    hookCandidateId: z.string().min(1).optional(),
    titleCandidateId: z.string().min(1).nullable().optional(),
    restoreRecommendation: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.restoreRecommendation === true ||
      value.hookCandidateId != null ||
      value.titleCandidateId !== undefined,
    "Choose an opening or title"
  );

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function authorizedClip(request: NextRequest, clipSuggestionId: string) {
  const clip = await prisma.clipSuggestion.findUnique({
    where: { id: clipSuggestionId },
    select: {
      id: true,
      streamSessionId: true,
      title: true,
      reason: true,
      confidence: true,
      startTimeSeconds: true,
      endTimeSeconds: true,
      rawAiJson: true,
      streamSession: {
        select: {
          title: true,
          description: true,
          channelTitle: true,
        },
      },
    },
  });
  if (!clip) return null;
  await ensureSessionBillingAccess(
    clip.streamSessionId,
    getBillingAccountIdFromRequest(request)
  );
  return clip;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ clipSuggestionId: string }> }
) {
  try {
    const { clipSuggestionId } = await params;
    const clip = await authorizedClip(request, clipSuggestionId);
    if (!clip) return errorResponse("Clip not found", 404);
    const raw = objectValue(clip.rawAiJson);
    let parsed = clipPackageSchema.safeParse(raw.hookPackage);
    if (!parsed.success) {
      const transcriptChunks = await getTranscriptChunksForRange(
        clip.streamSessionId,
        Math.max(0, clip.startTimeSeconds - 24),
        clip.endTimeSeconds + 26
      );
      const transcriptText = transcriptChunks.map((chunk) => chunk.text).join(" ");
      const storedContentType =
        typeof raw.contentType === "string" &&
        ["gaming", "podcast", "talking", "gameplay_only", "general"].includes(
          raw.contentType
        )
          ? (raw.contentType as ClipContentType)
          : null;
      const contentType =
        storedContentType ??
        inferClipContentType({
          title: clip.streamSession.title,
          description: clip.streamSession.description,
          transcript: transcriptText,
        });
      const profile = getClipContentProfile(contentType);
      const focusTimeSeconds =
        typeof raw.focusTimeSeconds === "number"
          ? raw.focusTimeSeconds
          : (clip.startTimeSeconds + clip.endTimeSeconds) / 2;
      let narrativePlan = planNarrativeClip({
        startTimeSeconds: clip.startTimeSeconds,
        endTimeSeconds: clip.endTimeSeconds,
        focusTimeSeconds,
        transcriptChunks,
        contentType,
        source: typeof raw.kind === "string" ? raw.kind : "existing_clip",
        targetMinSeconds: Math.min(profile.targetMinSeconds, 18),
        maximumDurationSeconds: Math.max(
          60,
          clip.endTimeSeconds - clip.startTimeSeconds
        ),
      });
      let visualContext: StructuredVisualContext | undefined;
      try {
        if (raw.visualContext && typeof raw.visualContext === "object") {
          visualContext = sanitizeStructuredVisualContext(
            raw.visualContext as StructuredVisualContext
          );
          narrativePlan = applyVisualContextToNarrativePlan(
            narrativePlan,
            visualContext
          );
        }
      } catch {
        visualContext = undefined;
      }
      const generated = buildLocalClipPackage({
        momentId: clip.id,
        creator: clip.streamSession.channelTitle,
        contentCategory: contentType,
        title: clip.title,
        startTimeSeconds: clip.startTimeSeconds,
        endTimeSeconds: clip.endTimeSeconds,
        focusTimeSeconds,
        momentQuality: clip.confidence * 100,
        transcriptChunks,
        visualContext,
        narrativePlan,
        mode: getHookEnginePolicy().mode,
      });
      await prisma.clipSuggestion.update({
        where: { id: clip.id },
        data: {
          rawAiJson: toJsonValue({
            ...raw,
            hookEngineVersion: generated.version,
            hookEngineMode: generated.mode,
            hookPackage: generated,
            hookDNA: generated.hookDNA,
          }),
        },
      });
      parsed = clipPackageSchema.safeParse(generated);
    }
    return jsonResponse({
      hookPackage: parsed.success ? parsed.data : null,
      mode: typeof raw.hookEngineMode === "string" ? raw.hookEngineMode : "legacy",
    });
  } catch (error) {
    if (error instanceof SessionAccessError) {
      return errorResponse(error.message, error.status);
    }
    return errorResponse(
      error instanceof Error ? error.message : "Failed to load hook package",
      500
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ clipSuggestionId: string }> }
) {
  try {
    const { clipSuggestionId } = await params;
    const clip = await authorizedClip(request, clipSuggestionId);
    if (!clip) return errorResponse("Clip not found", 404);
    const input = selectionSchema.parse(await request.json());
    const raw = objectValue(clip.rawAiJson);
    const parsed = clipPackageSchema.safeParse(raw.hookPackage);
    if (!parsed.success) return errorResponse("This clip has no Hook Engine package", 404);
    const current = parsed.data;
    const requestedHookId = input.restoreRecommendation
      ? current.recommendedHookCandidateId
      : input.hookCandidateId ?? current.selectedHook.candidateId;
    const selectedHook = current.hookCandidates.find(
      (candidate) => candidate.candidateId === requestedHookId
    );
    if (!selectedHook) return errorResponse("Opening candidate not found", 400);
    if (selectedHook.requiresTemporalReordering) {
      return errorResponse(
        "This payoff-tease opening is still in shadow review and cannot be applied yet.",
        409
      );
    }
    const updateOpening = input.restoreRecommendation === true || input.hookCandidateId != null;
    const nextStart = updateOpening
      ? Math.max(0, selectedHook.openingStartTimestamp)
      : clip.startTimeSeconds;
    if (clip.endTimeSeconds - nextStart < MIN_CLIP_SECONDS) {
      return errorResponse("The selected opening would make the clip too short", 400);
    }
    const requestedTitleId = input.restoreRecommendation
      ? current.recommendedTitleCandidateId
      : input.titleCandidateId === undefined
        ? current.selectedTitleCandidateId
        : input.titleCandidateId;
    const selectedTitle = requestedTitleId
      ? current.titleCandidates.find((candidate) => candidate.id === requestedTitleId)
      : null;
    if (requestedTitleId && !selectedTitle) {
      return errorResponse("Title candidate not found", 400);
    }
    const issues = reviewHookCandidate(selectedHook);
    if (issues.some((issue) => issue.severity === "critical")) {
      return errorResponse("The selected opening did not pass the package quality review", 409);
    }
    const restored = input.restoreRecommendation === true;
    const nextPackage = clipPackageSchema.parse({
      ...current,
      selectedHook,
      selectedTitleCandidateId: selectedTitle?.id ?? current.selectedTitleCandidateId,
      creatorSelection: restored
        ? null
        : {
            hookCandidateId: selectedHook.candidateId,
            titleCandidateId: selectedTitle?.id ?? null,
            updatedAt: new Date().toISOString(),
          },
      editPlan: {
        ...current.editPlan,
        sourceSegments: selectedHook.sourceSegments,
        temporalReorderingApplied: false,
        rationale: "Creator selected a grounded contiguous opening in Clip Studio.",
      },
      firstVisual: {
        ...current.firstVisual,
        timestampSeconds: selectedHook.firstVisualTimestamp,
        strength: selectedHook.visualStrength,
        motionLevel: selectedHook.openingMetrics.movementAtHalfSecond,
        reason: selectedHook.reasoningEvidence[0],
        evidence: selectedHook.reasoningEvidence,
      },
      firstCaption: {
        timestampSeconds: selectedHook.firstSpokenWordTimestamp,
        text: selectedHook.firstCaptionText,
        source: "transcript",
        appearsImmediately:
          selectedHook.firstSpokenWordTimestamp != null &&
          selectedHook.firstSpokenWordTimestamp - selectedHook.openingStartTimestamp <= 0.35,
      },
      qualityReview: {
        passed: true,
        repairPasses: current.qualityReview.repairPasses,
        issues,
      },
      hookDNA: {
        ...current.hookDNA,
        hookType: selectedHook.hookType,
        firstFrameTimestamp: selectedHook.firstVisualTimestamp,
        reactionStrength: selectedHook.reactionStrength,
        firstSpokenWordTimestamp: selectedHook.firstSpokenWordTimestamp,
        firstCaptionTimestamp: selectedHook.firstSpokenWordTimestamp,
        firstCaptionText: selectedHook.firstCaptionText,
        openingTranscript: selectedHook.hookTranscript,
        hookDuration: Math.max(
          0,
          selectedHook.openingEndTimestamp - selectedHook.openingStartTimestamp
        ),
        payoffTimestamp: selectedHook.payoffTimestamp,
        temporalReorderingUsed: false,
        titleStrategy: selectedTitle?.strategy ?? current.hookDNA.titleStrategy,
        title: selectedTitle?.title ?? current.hookDNA.title,
        creatorOverrides: restored
          ? current.hookDNA.creatorOverrides.filter(
              (override) => override !== "opening_changed" && override !== "title_changed"
            )
          : [
              ...new Set([
                ...current.hookDNA.creatorOverrides,
                ...(selectedHook.candidateId !== current.recommendedHookCandidateId
                  ? ["opening_changed"]
                  : []),
                ...(selectedTitle?.id !== current.selectedTitleCandidateId
                  ? ["title_changed"]
                  : []),
              ]),
            ],
      },
    });
    const updated = await prisma.clipSuggestion.update({
      where: { id: clip.id },
      data: {
        startTimeSeconds: nextStart,
        ...(selectedTitle ? { title: selectedTitle.title.slice(0, 200) } : {}),
        rawAiJson: toJsonValue({
          ...raw,
          hookPackage: nextPackage,
          hookDNA: nextPackage.hookDNA,
        }),
      },
      select: {
        id: true,
        title: true,
        startTimeSeconds: true,
        endTimeSeconds: true,
        reason: true,
        confidence: true,
        suggestedLayout: true,
        status: true,
      },
    });
    return jsonResponse({ hookPackage: nextPackage, clip: updated });
  } catch (error) {
    if (error instanceof SessionAccessError) {
      return errorResponse(error.message, error.status);
    }
    if (error instanceof z.ZodError) {
      return errorResponse(error.errors[0]?.message ?? "Invalid selection", 400);
    }
    return errorResponse(
      error instanceof Error ? error.message : "Failed to update hook package",
      500
    );
  }
}

