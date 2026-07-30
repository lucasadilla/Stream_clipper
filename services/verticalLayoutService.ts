import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { toJsonValue } from "@/lib/utils";
import { normalizeRect, type NormalizedRect } from "@/lib/normalizedRect";
import {
  buildActiveSpeakerCropPlan,
  buildSubjectCropPlan,
  recommendVerticalLayout,
  resolveLayoutName,
  type FacecamCandidate,
  type VerticalLayout,
  type VerticalLayoutRequest,
} from "@/lib/verticalLayout";
import type { ResolvedVerticalLayout } from "@/lib/verticalLayoutFilters";
import {
  getFaceAnalysisJob,
  parseStoredFaceAnalysisResult,
  type StoredFaceAnalysisResult,
} from "@/services/faceAnalysisService";

export interface VerticalLayoutResolution {
  resolved: ResolvedVerticalLayout;
  /** Layout actually used after resolving "auto" and fallbacks. */
  effectiveLayout: VerticalLayout;
  faceAnalysisJobId?: string;
  warnings: string[];
}

function candidateForSelection(
  analysis: StoredFaceAnalysisResult,
  trackId?: string
): FacecamCandidate | undefined {
  const all = [
    ...(analysis.primaryCandidate ? [analysis.primaryCandidate] : []),
    ...analysis.alternativeCandidates,
  ];
  if (trackId) {
    const match = all.find((candidate) => candidate.trackId === trackId);
    if (match) return match;
  }
  return analysis.primaryCandidate;
}

/**
 * Resolve a client layout request into concrete filter settings.
 *
 * Never throws for missing/failed analysis — every path degrades to a center
 * crop so a broken detection can never block a vertical export.
 */
export async function resolveVerticalLayout(
  request: VerticalLayoutRequest,
  options: {
    streamSessionId: string;
    clipStartSeconds: number;
    clipEndSeconds: number;
    outputWidth: number;
    outputHeight: number;
  }
): Promise<VerticalLayoutResolution> {
  const warnings: string[] = [];

  // Load the analysis result (explicit job id, or the newest completed job
  // overlapping this clip range).
  let analysis: StoredFaceAnalysisResult | null = null;
  let faceAnalysisJobId: string | undefined;
  if (request.faceAnalysisJobId) {
    const job = await getFaceAnalysisJob(request.faceAnalysisJobId);
    if (job?.streamSessionId === options.streamSessionId && job.status === "completed") {
      analysis = parseStoredFaceAnalysisResult(job.resultJson);
      faceAnalysisJobId = job.id;
    }
  }
  if (!analysis) {
    const job = await prisma.faceAnalysisJob.findFirst({
      where: {
        streamSessionId: options.streamSessionId,
        status: "completed",
        startSeconds: { lte: options.clipStartSeconds + 1 },
        endSeconds: { gte: options.clipEndSeconds - 1 },
      },
      orderBy: { completedAt: "desc" },
    });
    if (job) {
      analysis = parseStoredFaceAnalysisResult(job.resultJson);
      faceAnalysisJobId = job.id;
    }
  }

  // Resolve "auto" using the stored recommendation.
  let layout = resolveLayoutName(request.layout);
  if (layout === "auto") {
    if (analysis) {
      layout = resolveLayoutName(
        analysis.recommendation?.layout ??
          recommendVerticalLayout(
            analysis.classification,
            analysis.primaryCandidate
          ).layout
      );
    } else {
      layout = "center_crop";
      warnings.push(
        "Face analysis was not available, so Center Crop was used."
      );
    }
  }

  // Resolve the facecam rectangle: manual override wins, then the selected or
  // primary candidate.
  let facecamRect: NormalizedRect | undefined;
  let faceRect: NormalizedRect | undefined;
  let selectedTrackId: string | undefined;
  if (request.faceSelection.mode === "manual" && request.faceSelection.manualRect) {
    facecamRect = normalizeRect(request.faceSelection.manualRect) ?? undefined;
    faceRect = facecamRect;
    if (!facecamRect) {
      warnings.push("The manual facecam region was invalid and was ignored.");
    }
  }
  if (!facecamRect && analysis) {
    const candidate = candidateForSelection(
      analysis,
      request.faceSelection.trackId
    );
    if (candidate) {
      facecamRect = normalizeRect(candidate.rect) ?? undefined;
      faceRect =
        normalizeRect(candidate.faceRect ?? candidate.rect) ?? undefined;
      selectedTrackId = candidate.trackId;
    }
  }

  const needsFacecam =
    layout === "facecam_top_gameplay_bottom" ||
    layout === "facecam_bottom_gameplay_top" ||
    layout === "facecam_pip";
  if (needsFacecam && !facecamRect) {
    warnings.push(
      "No facecam region was available, so Center Crop was used instead."
    );
    layout = "center_crop";
  }

  // Prefer face-centered horizontal crop when using center crop / auto fallback.
  const faceCenterX =
    faceRect != null
      ? faceRect.x + faceRect.width / 2
      : facecamRect != null
        ? facecamRect.x + facecamRect.width / 2
        : undefined;

  const resolved: ResolvedVerticalLayout = {
    layout: layout as ResolvedVerticalLayout["layout"],
    facecamRect,
    faceRect,
    // Blur/cover targets the region where the facecam sits in the original
    // frame — same as the resolved crop unless a manual rect moved it.
    originalFacecamRect:
      analysis?.primaryCandidate?.rect ?? facecamRect,
    stacked: request.stacked
      ? {
          facecamPosition:
            layout === "facecam_bottom_gameplay_top"
              ? "bottom"
              : request.stacked.facecamPosition,
          facecamHeightRatio: request.stacked.facecamHeightRatio,
          dividerSize: request.stacked.dividerSize,
          dividerColor: request.stacked.dividerColor,
          hideOriginalFacecam: request.stacked.hideOriginalFacecam,
        }
      : undefined,
    pip: request.pip,
    centerCrop: {
      focalPointX:
        request.centerCrop?.focalPointX ??
        (faceCenterX != null ? faceCenterX : 0.5),
      zoom: request.centerCrop?.zoom ?? 1,
      useBlurredBackground: request.centerCrop?.useBlurredBackground ?? false,
    },
  };

  if (layout === "subject_aware_crop") {
    // Manual selection intentionally locks to one person. Auto selection on a
    // multi-person clip follows local mouth activity so the crop changes with
    // the conversation instead of sticking to one whole-clip "best" face.
    const track =
      analysis?.tracks.find(
        (t) => t.id === (request.faceSelection.trackId ?? selectedTrackId)
      ) ??
      (analysis && analysis.primaryCandidate
        ? analysis.tracks.find((t) => t.id === analysis!.primaryCandidate!.trackId)
        : undefined) ??
      analysis?.tracks
        .slice()
        .sort((a, b) => b.points.length - a.points.length)[0];

    if (track && track.points.length > 0) {
      const cropWidthRatio =
        (options.outputWidth / options.outputHeight) *
        ((analysis?.sourceHeight ?? 1080) / (analysis?.sourceWidth ?? 1920));
      const normalizedCropWidth = Math.min(
        0.95,
        Math.max(0.1, cropWidthRatio)
      );
      const followActiveSpeaker =
        request.faceSelection.mode === "auto" &&
        !request.faceSelection.trackId &&
        analysis?.classification === "multiple_faces" &&
        analysis.tracks.filter((item) => item.points.length >= 3).length >= 2;
      resolved.subjectCrop = {
        keyframes: followActiveSpeaker
          ? buildActiveSpeakerCropPlan(
              analysis!.tracks,
              options.clipStartSeconds,
              options.clipEndSeconds,
              normalizedCropWidth
            )
          : buildSubjectCropPlan(
              track.points,
              options.clipStartSeconds,
              options.clipEndSeconds,
              normalizedCropWidth,
              {
                smoothing: request.subjectCrop?.smoothing,
                deadZoneRatio: request.subjectCrop?.deadZoneRatio,
                maxPanSpeed: request.subjectCrop?.maxPanSpeed,
                fallback: request.subjectCrop?.fallback,
              }
            ),
      };
    } else {
      warnings.push(
        "No face track was available for Follow speaker, so Center Crop was used instead."
      );
      resolved.layout = "center_crop";
    }
  }

  return {
    resolved,
    effectiveLayout: resolved.layout,
    faceAnalysisJobId,
    warnings,
  };
}

/** Persist the chosen layout so reopening the clip restores the settings. */
export async function saveVerticalLayoutConfiguration(options: {
  streamSessionId: string;
  clipSuggestionId: string;
  request: VerticalLayoutRequest;
  faceAnalysisJobId?: string;
}): Promise<string> {
  const { request } = options;
  const settingsJson = toJsonValue({
    stacked: request.stacked,
    pip: request.pip,
    subjectCrop: request.subjectCrop,
    centerCrop: request.centerCrop,
    captions: request.captions,
  }) as Prisma.InputJsonValue;

  const data = {
    streamSessionId: options.streamSessionId,
    faceAnalysisJobId: options.faceAnalysisJobId ?? request.faceAnalysisJobId,
    layout: request.layout,
    faceSelectionMode: request.faceSelection.mode,
    selectedTrackId: request.faceSelection.trackId ?? null,
    manualFaceRect: request.faceSelection.manualRect
      ? (toJsonValue(request.faceSelection.manualRect) as Prisma.InputJsonValue)
      : Prisma.JsonNull,
    settingsJson,
  } as const;

  const saved = await prisma.verticalLayoutConfiguration.upsert({
    where: { clipSuggestionId: options.clipSuggestionId },
    create: { clipSuggestionId: options.clipSuggestionId, ...data },
    update: data,
  });
  return saved.id;
}

export async function getVerticalLayoutConfiguration(clipSuggestionId: string) {
  return prisma.verticalLayoutConfiguration.findUnique({
    where: { clipSuggestionId },
  });
}
