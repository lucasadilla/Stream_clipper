import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { toJsonValue } from "@/lib/utils";
import { normalizeRect, type NormalizedRect } from "@/lib/normalizedRect";
import {
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
  let selectedTrackId: string | undefined;
  if (request.faceSelection.mode === "manual" && request.faceSelection.manualRect) {
    facecamRect = normalizeRect(request.faceSelection.manualRect) ?? undefined;
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

  const resolved: ResolvedVerticalLayout = {
    layout: layout as ResolvedVerticalLayout["layout"],
    facecamRect,
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
    centerCrop: request.centerCrop,
  };

  if (layout === "subject_aware_crop") {
    // Prefer an explicitly selected face, then the analysis primary (already
    // ranked by speaking score for talking-head content), then the longest track.
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
      resolved.subjectCrop = {
        keyframes: buildSubjectCropPlan(
          track.points,
          options.clipStartSeconds,
          options.clipEndSeconds,
          Math.min(0.95, Math.max(0.1, cropWidthRatio)),
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
