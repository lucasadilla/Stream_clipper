import { NextRequest } from "next/server";
import { errorResponse, jsonResponse } from "@/lib/utils";
import { getBillingAccountIdFromRequest } from "@/services/billingService";
import {
  ensureSessionBillingAccess,
  SessionAccessError,
} from "@/services/sessionAccessService";
import {
  getFaceAnalysisJob,
  parseStoredFaceAnalysisResult,
} from "@/services/faceAnalysisService";
import {
  buildActiveSpeakerCropPlan,
  buildSubjectCropPlan,
} from "@/lib/verticalLayout";
import {
  generateProfessionalReframePlan,
  REFRAME_STYLES,
  type ReframeStyle,
} from "@/lib/professionalReframe";

export const runtime = "nodejs";

/**
 * Poll a face-analysis job. Once completed, includes the classification,
 * candidates, recommendation, warnings and a representative frame URL for the
 * manual-adjust UI. Raw track points stay server-side except for candidates.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;
    const job = await getFaceAnalysisJob(jobId);
    if (!job) return errorResponse("Analysis job not found", 404);

    const billingAccountId = getBillingAccountIdFromRequest(request);
    try {
      await ensureSessionBillingAccess(job.streamSessionId, billingAccountId);
    } catch (err) {
      if (err instanceof SessionAccessError) {
        return errorResponse(err.message, err.status);
      }
      throw err;
    }

    const base = {
      id: job.id,
      status: job.status,
      progress: job.progress,
      errorMessage: job.errorMessage,
      classification: job.classification,
      confidence: job.confidence,
    };

    if (job.status !== "completed") {
      return jsonResponse({ job: base });
    }

    const result = parseStoredFaceAnalysisResult(job.resultJson);
    if (!result) {
      return jsonResponse({ job: base });
    }

    const cropWidthRatio = Math.min(
      0.95,
      Math.max(
        0.1,
        (9 / 16) * (result.sourceHeight / Math.max(1, result.sourceWidth))
      )
    );
    const primaryTrack = result.primaryCandidate
      ? result.tracks.find(
          (track) => track.id === result.primaryCandidate?.trackId
        )
      : undefined;
    const usableTracks = result.tracks.filter(
      (track) => track.points.length >= 3
    );
    const requestedStyle = request.nextUrl.searchParams.get("style");
    const style = REFRAME_STYLES.includes(requestedStyle as ReframeStyle)
      ? (requestedStyle as ReframeStyle)
      : "professional";
    const lockSubject = request.nextUrl.searchParams.get("lockSubject") === "true";
    const requestedStartParam = request.nextUrl.searchParams.get("startSeconds");
    const requestedEndParam = request.nextUrl.searchParams.get("endSeconds");
    const requestedStart =
      requestedStartParam == null ? Number.NaN : Number(requestedStartParam);
    const requestedEnd =
      requestedEndParam == null ? Number.NaN : Number(requestedEndParam);
    const clipStartSeconds = Number.isFinite(requestedStart)
      ? Math.max(result.startSeconds, requestedStart)
      : result.startSeconds;
    const clipEndSeconds = Number.isFinite(requestedEnd)
      ? Math.min(result.endSeconds, Math.max(clipStartSeconds + 0.1, requestedEnd))
      : result.endSeconds;
    const requestedPlan = generateProfessionalReframePlan({
      clipId: result.clipId ?? job.id,
      clipStartSeconds,
      clipEndSeconds,
      sourceWidth: result.sourceWidth,
      sourceHeight: result.sourceHeight,
      classification: result.classification,
      tracks: result.tracks,
      sampledFrames: Math.max(
        1,
        Math.round(result.sampleFps * (result.endSeconds - result.startSeconds))
      ),
      primaryTrackId: result.primaryCandidate?.trackId,
      lockedTrackId: lockSubject ? result.primaryCandidate?.trackId : undefined,
      sceneChanges: result.professionalPlan?.scenes
        .filter((scene) => scene.transitionIn === "hard_cut")
        .map((scene) => ({
          timestampSeconds: scene.startSeconds,
          score: scene.confidence,
        })),
      style,
    });
    const previewKeyframes = requestedPlan.cropKeyframes.length
      ? requestedPlan.cropKeyframes
      : result.classification === "multiple_faces" && usableTracks.length >= 2
        ? buildActiveSpeakerCropPlan(
            usableTracks,
            result.startSeconds,
            result.endSeconds,
            cropWidthRatio
          )
        : primaryTrack
          ? buildSubjectCropPlan(
              primaryTrack.points,
              result.startSeconds,
              result.endSeconds,
              cropWidthRatio
            )
          : [];

    return jsonResponse({
      job: {
        ...base,
        analysisVersion: result.analysisVersion ?? 1,
        sourceWidth: result.sourceWidth,
        sourceHeight: result.sourceHeight,
        primaryCandidate: result.primaryCandidate ?? null,
        alternativeCandidates: result.alternativeCandidates,
        recommendation: result.recommendation,
        warnings: result.warnings,
        previewKeyframes,
        professionalPlan: requestedPlan
          ? {
              version: requestedPlan.version,
              style: requestedPlan.style,
              sourceLayout: requestedPlan.sourceLayout,
              overallConfidence: requestedPlan.overallConfidence,
              scenes: requestedPlan.scenes,
              shots: requestedPlan.shots,
              validation: requestedPlan.validation,
            }
          : null,
        frameUrl: result.frameStoragePath
          ? `/api/storage/${result.frameStoragePath.replace(/\\/g, "/")}?inline=1`
          : null,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load analysis";
    return errorResponse(message, 500);
  }
}
