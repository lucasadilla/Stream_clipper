import { prisma } from "@/lib/db";
import { lookPresetFromLayout } from "@/lib/contentLookPresets";
import {
  contentTypeFromVisualClassification,
  type ClipContentType,
} from "@/lib/clipContentProfile";
import { toJsonValue } from "@/lib/utils";
import {
  parseVerticalLayoutRequest,
  type VerticalLayout,
  type VerticalLayoutRequest,
} from "@/lib/verticalLayout";
import { requestFaceAnalysis } from "@/services/faceAnalysisService";
import {
  getVerticalLayoutConfiguration,
  saveVerticalLayoutConfiguration,
} from "@/services/verticalLayoutService";

export type ClipRange = {
  id: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
};

/** Default auto layout used when agent prepares clips without user input. */
export function buildAutoVerticalLayoutRequest(
  faceAnalysisJobId?: string | null,
  contentType: ClipContentType = "general"
): VerticalLayoutRequest {
  const isGaming =
    contentType === "gaming" || contentType === "gameplay_only";
  const isConversation = contentType === "podcast";
  return (
    parseVerticalLayoutRequest({
      layout: "auto",
      faceAnalysisJobId: faceAnalysisJobId ?? undefined,
      faceSelection: { mode: "auto" },
      stacked: {
        facecamPosition: "top",
        facecamHeightRatio: isGaming ? 0.34 : 0.4,
        dividerSize: 0,
        dividerColor: "#000000",
        hideOriginalFacecam: "blur",
      },
      pip: {
        position: "top_right",
        widthRatio: 0.34,
        margin: 0.04,
        borderSize: 3,
        borderColor: "#FFFFFF",
        hideOriginalFacecam: "blur",
      },
      subjectCrop: {
        smoothing: isConversation ? 0.28 : 0.35,
        deadZoneRatio: isConversation ? 0.2 : 0.45,
        maxPanSpeed: isConversation ? 0.55 : 0.4,
        fallback: "hold",
      },
      captions: { enabled: true, position: "lower" },
    }) ?? {
      layout: "auto",
      faceSelection: { mode: "auto" },
      captions: { enabled: true, position: "lower" },
    }
  );
}

export { lookPresetFromLayout };

/**
 * Kick off face analysis + save auto vertical layout for suggested clips.
 * Non-blocking-friendly: callers should void this without awaiting the whole batch.
 */
export async function prepareSuggestedClips(
  streamSessionId: string,
  clips: ClipRange[]
): Promise<void> {
  if (clips.length === 0) return;

  const existing = await prisma.verticalLayoutConfiguration.findMany({
    where: { clipSuggestionId: { in: clips.map((c) => c.id) } },
    select: { clipSuggestionId: true, faceAnalysisJobId: true },
  });
  const ready = new Set(
    existing
      .filter((c) => c.faceAnalysisJobId)
      .map((c) => c.clipSuggestionId)
  );

  // Prepare serially. Each range can require a temporary media segment, and
  // parallel warm-up can exhaust a small Railway volume before cleanup runs.
  const queue = clips.filter((c) => !ready.has(c.id));
  for (const clip of queue) {
    await prepareOneSuggestedClip(streamSessionId, clip).catch(() => null);
  }
}

async function prepareOneSuggestedClip(
  streamSessionId: string,
  clip: ClipRange
): Promise<void> {
  const { jobId, status } = await requestFaceAnalysis({
    streamSessionId,
    clipSuggestionId: clip.id,
    startSeconds: clip.startTimeSeconds,
    endSeconds: clip.endTimeSeconds,
  });

  const faceReady = status === "completed" ? jobId : undefined;
  await saveVerticalLayoutConfiguration({
    streamSessionId,
    clipSuggestionId: clip.id,
    request: buildAutoVerticalLayoutRequest(faceReady),
    faceAnalysisJobId: faceReady,
  });

  if (status === "completed") {
    await applyCompletedFaceAnalysisToClip(jobId);
  }
}

/**
 * After face analysis finishes, link the job to the clip's vertical layout and
 * stamp the recommended layout onto the clip for UI / export.
 */
export async function applyCompletedFaceAnalysisToClip(
  jobId: string
): Promise<void> {
  const job = await prisma.faceAnalysisJob.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      status: true,
      clipSuggestionId: true,
      streamSessionId: true,
      resultJson: true,
      clipSuggestion: {
        select: { rawAiJson: true },
      },
    },
  });
  if (!job || job.status !== "completed" || !job.clipSuggestionId) return;

  const result = job.resultJson as {
    classification?: string;
    recommendation?: { layout?: VerticalLayout };
  } | null;
  const recommended = result?.recommendation?.layout;
  const visualContentType = contentTypeFromVisualClassification(
    result?.classification ?? ""
  );

  const existing = await getVerticalLayoutConfiguration(job.clipSuggestionId);
  // Don't overwrite a user-chosen non-auto layout.
  if (existing && existing.layout !== "auto") {
    if (!existing.faceAnalysisJobId) {
      await prisma.verticalLayoutConfiguration.update({
        where: { clipSuggestionId: job.clipSuggestionId },
        data: { faceAnalysisJobId: job.id },
      });
    }
    return;
  }

  await saveVerticalLayoutConfiguration({
    streamSessionId: job.streamSessionId,
    clipSuggestionId: job.clipSuggestionId,
    request: buildAutoVerticalLayoutRequest(job.id, visualContentType),
    faceAnalysisJobId: job.id,
  });

  if (recommended) {
    const existingRaw =
      job.clipSuggestion?.rawAiJson &&
      typeof job.clipSuggestion.rawAiJson === "object" &&
      !Array.isArray(job.clipSuggestion.rawAiJson)
        ? job.clipSuggestion.rawAiJson
        : {};
    await prisma.clipSuggestion.update({
      where: { id: job.clipSuggestionId },
      data: {
        suggestedLayout: recommended,
        rawAiJson: toJsonValue({
          ...existingRaw,
          visualContentType,
        }),
      },
    });
  }
}
