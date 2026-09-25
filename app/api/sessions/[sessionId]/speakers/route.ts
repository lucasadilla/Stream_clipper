import { NextRequest } from "next/server";
import { z } from "zod";
import { errorResponse, jsonResponse } from "@/lib/utils";
import { getBillingAccountIdFromRequest } from "@/services/billingService";
import {
  ensureSessionBillingAccess,
  SessionAccessError,
} from "@/services/sessionAccessService";
import {
  ensureSpeakerContext,
  correctSpeakerRange,
  isSpeakerVisibility,
  mergeSpeakerIdentities,
  splitSpeakerRange,
  updateSpeakerIdentity,
} from "@/services/speakerContextService";

export const runtime = "nodejs";

const updateSchema = z.object({
  action: z.literal("update"),
  speakerId: z.string().min(1),
  displayName: z.string().max(80).optional(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  visibility: z.enum(["visible", "offscreen", "unknown"]).optional(),
  faceTrackId: z.string().max(160).nullable().optional(),
  faceMappingConfidence: z.number().min(0).max(1).optional(),
});

const mergeSchema = z.object({
  action: z.literal("merge"),
  sourceSpeakerId: z.string().min(1),
  targetSpeakerId: z.string().min(1),
});

const assignRangeSchema = z.object({
  action: z.literal("assign_range"),
  speakerId: z.string().min(1),
  startTimeSeconds: z.number().min(0),
  endTimeSeconds: z.number().positive(),
});

const splitRangeSchema = z.object({
  action: z.literal("split_range"),
  sourceSpeakerId: z.string().min(1),
  startTimeSeconds: z.number().min(0),
  endTimeSeconds: z.number().positive(),
});

const patchSchema = z.discriminatedUnion("action", [
  updateSchema,
  mergeSchema,
  assignRangeSchema,
  splitRangeSchema,
]);

async function authorize(request: NextRequest, sessionId: string) {
  await ensureSessionBillingAccess(
    sessionId,
    getBillingAccountIdFromRequest(request)
  );
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    await authorize(request, sessionId);
    const context = await ensureSpeakerContext(sessionId);
    return jsonResponse({ context });
  } catch (error) {
    if (error instanceof SessionAccessError) {
      return errorResponse(error.message, error.status);
    }
    return errorResponse(
      error instanceof Error ? error.message : "Failed to load speakers",
      500
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    await authorize(request, sessionId);
    const body = patchSchema.parse(await request.json());
    const context =
      body.action === "merge"
        ? await mergeSpeakerIdentities(
            sessionId,
            body.sourceSpeakerId,
            body.targetSpeakerId
          )
        : body.action === "assign_range"
          ? await correctSpeakerRange(sessionId, body)
          : body.action === "split_range"
            ? await splitSpeakerRange(sessionId, body)
            : await updateSpeakerIdentity(sessionId, body.speakerId, {
            ...(body.displayName !== undefined
              ? { displayName: body.displayName }
              : {}),
            ...(body.color !== undefined ? { color: body.color } : {}),
            ...(isSpeakerVisibility(body.visibility)
              ? { visibility: body.visibility }
              : {}),
            ...(body.faceTrackId !== undefined
              ? { faceTrackId: body.faceTrackId ?? undefined }
              : {}),
            ...(body.faceMappingConfidence !== undefined
              ? { faceMappingConfidence: body.faceMappingConfidence }
              : {}),
              });
    return jsonResponse({ context });
  } catch (error) {
    if (error instanceof SessionAccessError) {
      return errorResponse(error.message, error.status);
    }
    if (error instanceof z.ZodError) {
      return errorResponse(error.errors[0]?.message ?? "Invalid speaker update", 400);
    }
    return errorResponse(
      error instanceof Error ? error.message : "Failed to update speakers",
      500
    );
  }
}
