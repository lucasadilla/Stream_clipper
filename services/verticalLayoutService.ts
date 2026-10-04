import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { toJsonValue } from "@/lib/utils";
import { normalizeRect, type NormalizedRect } from "@/lib/normalizedRect";
import {
  bestEmbeddedFacecamCandidate,
  buildActiveSpeakerCropPlan,
  buildSubjectCropPlan,
  parseVerticalLayoutRequest,
  recommendVerticalLayout,
  resolveLayoutName,
  type FacecamCandidate,
  type VerticalLayout,
  type VerticalLayoutRequest,
} from "@/lib/verticalLayout";
import { generateProfessionalReframePlan } from "@/lib/professionalReframe";
import type { ResolvedVerticalLayout } from "@/lib/verticalLayoutFilters";
import {
  getFaceAnalysisJob,
  parseStoredFaceAnalysisResult,
  type StoredFaceAnalysisResult,
} from "@/services/faceAnalysisService";
import {
  buildGameplayCropKeyframes,
  planGameplayLayout,
  verticalLayoutForAutomaticPlan,
} from "@/lib/gameplayLayout";
import type { CaptionSafeZone } from "@/lib/verticalLayout";
import { contextAwareCropKeyframesForRange } from "@/lib/contextAwareFraming";

function mergeManualCropKeyframes(
  automatic: NonNullable<ResolvedVerticalLayout["gameplayCrop"]>["keyframes"],
  manual: NonNullable<VerticalLayoutRequest["reframe"]>["manualKeyframes"]
) {
  if (!manual?.length) return automatic;
  return [
    ...automatic.filter(
      (frame) =>
        !manual.some(
          (override) =>
            Math.abs(override.timestampSeconds - frame.timestampSeconds) < 0.2
        )
    ),
    ...manual.map((frame) => ({
      ...frame,
      reason: "manual_override" as const,
      confidence: 1,
    })),
  ].sort((a, b) => a.timestampSeconds - b.timestampSeconds);
}

export interface VerticalLayoutResolution {
  resolved: ResolvedVerticalLayout;
  /** Layout actually used after resolving "auto" and fallbacks. */
  effectiveLayout: VerticalLayout;
  faceAnalysisJobId?: string;
  warnings: string[];
  captionSafeZone?: CaptionSafeZone;
}

function candidateForSelection(
  analysis: StoredFaceAnalysisResult,
  trackId?: string,
  preferEmbeddedFacecam = false
): FacecamCandidate | undefined {
  const all = [
    ...(analysis.primaryCandidate ? [analysis.primaryCandidate] : []),
    ...analysis.alternativeCandidates,
  ];
  if (trackId) {
    const match = all.find((candidate) => candidate.trackId === trackId);
    if (match) return match;
  }
  if (preferEmbeddedFacecam) {
    return bestEmbeddedFacecamCandidate(all);
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

  // The importance map and source tracking are shared across exports. Layout
  // planning is cheap, so rerank geometry for the actual target dimensions
  // instead of forcing square or alternate vertical variants through a 9:16
  // plan generated during analysis.
  const analyzedFacecam = analysis
    ? bestEmbeddedFacecamCandidate([
        ...(analysis.primaryCandidate ? [analysis.primaryCandidate] : []),
        ...analysis.alternativeCandidates,
      ])
    : undefined;
  let gameplayPlan =
    analysis?.gameplayLayoutEligible !== false && analysis?.gameplayImportanceMap
    ? planGameplayLayout({
        map: analysis.gameplayImportanceMap,
        classification: analysis.classification,
        facecam: analyzedFacecam,
        tracks: analysis.tracks,
        primaryTrackId:
          analyzedFacecam?.trackId ?? analysis.primaryCandidate?.trackId,
        sourceWidth: analysis.sourceWidth,
        sourceHeight: analysis.sourceHeight,
        outputWidth: options.outputWidth,
        outputHeight: options.outputHeight,
      })
    : analysis?.gameplayLayoutPlan;
  if (
    gameplayPlan?.selectedFamily === "dynamic_reaction" &&
    request.reframe?.reactionEmphasis === false &&
    analysis?.gameplayImportanceMap
  ) {
    const fallback = gameplayPlan.candidates.find(
      (candidate) =>
        candidate.family !== "dynamic_reaction" && candidate.validation.valid
    );
    if (fallback) {
      gameplayPlan = {
        ...gameplayPlan,
        selectedFamily: fallback.family,
        selectedCandidateId: fallback.id,
        reason: `${fallback.reason} Reaction enlargement was disabled by the creator.`,
        gameplayCropKeyframes: buildGameplayCropKeyframes(
          analysis.gameplayImportanceMap,
          fallback.gameplayCropWidth
        ),
        captionSafeZone: fallback.captionSafeZone,
        segments: [
          {
            id: "layout-1",
            startTimeSeconds: options.clipStartSeconds,
            endTimeSeconds: options.clipEndSeconds,
            family: fallback.family,
            transitionIn: "start",
            reason: "Creator disabled reaction enlargement.",
          },
        ],
      };
    }
  }

  // Resolve "auto" using the stored recommendation.
  const automaticRequest = request.layout === "auto";
  const gameplayOnlyRequest = request.layout === "gameplay_full";
  const hasReliableFaceTracking = Boolean(
    analysis &&
      analysis.confidence >= 0.45 &&
      analysis.classification !== "no_face" &&
      analysis.classification !== "already_vertical" &&
      analysis.classification !== "gameplay_only" &&
      analysis.tracks.some((track) => track.points.length >= 3)
  );
  let layout = resolveLayoutName(request.layout);
  if (layout === "auto") {
    if (analysis) {
      if (gameplayPlan) {
        layout = resolveLayoutName(
          verticalLayoutForAutomaticPlan(
            gameplayPlan.selectedFamily,
            analysis.recommendation?.layout,
            hasReliableFaceTracking
          )
        );
      } else if (analysis.confidence < 0.45) {
        layout = "center_crop";
        warnings.push(
          "Tracking confidence was low, so a stable Center Crop was used."
        );
      } else {
        layout = resolveLayoutName(
          analysis.recommendation?.layout ??
            recommendVerticalLayout(
              analysis.classification,
              analysis.primaryCandidate
            ).layout
        );
      }
    } else {
      layout = "center_crop";
      warnings.push(
        "Face analysis was not available, so Center Crop was used."
      );
    }
  }
  if (automaticRequest && layout === "center_crop" && hasReliableFaceTracking) {
    layout = "subject_aware_crop";
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
    const preferEmbeddedFacecam =
      layout === "facecam_top_gameplay_bottom" ||
      layout === "facecam_bottom_gameplay_top";
    const candidate = candidateForSelection(
      analysis,
      request.faceSelection.trackId,
      preferEmbeddedFacecam
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
  const gameplayCropKeyframes = gameplayPlan?.gameplayCropKeyframes.length
    ? mergeManualCropKeyframes(
        gameplayPlan.gameplayCropKeyframes,
        request.reframe?.manualKeyframes
      )
    : [];
  const gameplayCandidate = automaticRequest
    ? gameplayPlan?.candidates.find(
        (candidate) => candidate.id === gameplayPlan.selectedCandidateId
      )
    : undefined;
  if (gameplayOnlyRequest && gameplayPlan?.gameplayCropKeyframes.length) {
    layout = "subject_aware_crop";
  }

  const resolved: ResolvedVerticalLayout = {
    layout: layout as ResolvedVerticalLayout["layout"],
    facecamRect,
    faceRect,
    // The gameplay branch must remove the same embedded webcam selected for
    // the face panel. Using the generic primary candidate here could target an
    // in-game character while leaving the real webcam visible.
    originalFacecamRect: facecamRect,
    stacked:
      request.stacked ||
      gameplayCandidate?.family === "stacked" ||
      gameplayCandidate?.family === "dynamic_reaction"
      ? {
          facecamPosition:
            layout === "facecam_bottom_gameplay_top"
              ? "bottom"
              : request.stacked?.facecamPosition ?? "top",
          facecamHeightRatio:
            gameplayCandidate?.family === "stacked" ||
            gameplayCandidate?.family === "dynamic_reaction"
              ? gameplayCandidate.splitRatio ??
                request.stacked?.facecamHeightRatio ??
                0.38
              : request.stacked?.facecamHeightRatio ?? 0.38,
          dividerSize: request.stacked?.dividerSize ?? 0,
          dividerColor: request.stacked?.dividerColor ?? "#000000",
          hideOriginalFacecam:
            request.stacked?.hideOriginalFacecam ?? "crop_out",
        }
      : undefined,
    pip:
      request.pip ||
      gameplayCandidate?.family === "pip" ||
      gameplayCandidate?.family === "dynamic_reaction"
      ? {
          position: request.pip?.position ?? "top_right",
          widthRatio: request.pip?.widthRatio ?? 0.34,
          margin: request.pip?.margin ?? 0.04,
          borderSize: request.pip?.borderSize ?? 3,
          borderColor: request.pip?.borderColor ?? "#FFFFFF",
          hideOriginalFacecam: request.pip?.hideOriginalFacecam ?? "crop_out",
          ...(gameplayCandidate?.family === "pip" ||
          gameplayCandidate?.family === "dynamic_reaction"
            ? {
                position:
                  gameplayCandidate.pipPosition ??
                  request.pip?.position ??
                  "top_right",
                widthRatio:
                  gameplayCandidate.pipWidthRatio ??
                  request.pip?.widthRatio ??
                  0.34,
              }
            : {}),
        }
      : undefined,
    gameplayCrop: gameplayCropKeyframes.length
      ? {
          keyframes: gameplayCropKeyframes,
          planVersion: gameplayPlan!.version,
          style: "gameplay_importance",
        }
      : undefined,
    dynamicSegments:
      automaticRequest && gameplayCandidate?.family === "dynamic_reaction"
        ? gameplayPlan?.segments
            .filter(
              (segment) =>
                segment.family === "pip" || segment.family === "stacked"
            )
            .map((segment) => ({
              startTimeSeconds: Math.max(
                0,
                segment.startTimeSeconds - options.clipStartSeconds
              ),
              endTimeSeconds: Math.max(
                0,
                segment.endTimeSeconds - options.clipStartSeconds
              ),
              family: segment.family as "pip" | "stacked",
            }))
        : undefined,
    centerCrop: {
      focalPointX:
        request.centerCrop?.focalPointX ??
        (faceCenterX != null ? faceCenterX : 0.5),
      zoom: request.centerCrop?.zoom ?? 1,
      useBlurredBackground:
        gameplayPlan?.selectedFamily === "conservative"
          ? true
          : request.centerCrop?.useBlurredBackground ?? false,
    },
  };

  if (layout === "subject_aware_crop") {
    if (
      (gameplayPlan?.selectedFamily === "gameplay_only" || gameplayOnlyRequest) &&
      gameplayCropKeyframes.length > 0
    ) {
      resolved.subjectCrop = {
        keyframes: gameplayCropKeyframes,
        planVersion: gameplayPlan!.version,
        style: "gameplay_importance",
      };
    } else {
      // Manual selection intentionally locks to one person. Auto selection on
      // a multi-person clip follows local mouth activity instead of sticking
      // to one whole-clip "best" face.
      const track =
        analysis?.tracks.find(
          (t) => t.id === (request.faceSelection.trackId ?? selectedTrackId)
        ) ??
        (analysis && analysis.primaryCandidate
          ? analysis.tracks.find(
              (t) => t.id === analysis!.primaryCandidate!.trackId
            )
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
      const lockedTrackId = request.reframe?.lockSubject
        ? request.reframe.lockedTrackId ??
          request.faceSelection.trackId ??
          selectedTrackId ??
          analysis?.primaryCandidate?.trackId
        : undefined;
      const professionalPlan = analysis
        ? generateProfessionalReframePlan({
            clipId: analysis.clipId ?? faceAnalysisJobId ?? options.streamSessionId,
            clipStartSeconds: options.clipStartSeconds,
            clipEndSeconds: options.clipEndSeconds,
            sourceWidth: analysis.sourceWidth,
            sourceHeight: analysis.sourceHeight,
            classification: analysis.classification,
            tracks: analysis.tracks,
            sampledFrames: Math.max(
              1,
              Math.round(
                analysis.sampleFps *
                  (analysis.endSeconds - analysis.startSeconds)
              )
            ),
            primaryTrackId:
              request.faceSelection.trackId ??
              selectedTrackId ??
              analysis.primaryCandidate?.trackId,
            lockedTrackId,
            sceneChanges: analysis.professionalPlan?.scenes
              .filter((scene) => scene.transitionIn === "hard_cut")
              .map((scene) => ({
                timestampSeconds: scene.startSeconds,
                score: scene.confidence,
              })),
            style: request.reframe?.style ?? "professional",
          })
        : null;
      const contextAwareKeyframes =
        analysis &&
        request.faceSelection.mode === "auto" &&
        !request.faceSelection.trackId &&
        !request.reframe?.lockSubject
          ? contextAwareCropKeyframesForRange({
              plan: analysis.contextAwareFraming,
              startTimeSeconds: options.clipStartSeconds,
              endTimeSeconds: options.clipEndSeconds,
            })
          : [];
      const professionalWidths = (professionalPlan?.cropKeyframes ?? [])
        .map((frame) => frame.cropWidth)
        .filter((value) => Number.isFinite(value))
        .sort((left, right) => left - right);
      const professionalHeights = (professionalPlan?.cropKeyframes ?? [])
        .map((frame) => frame.cropHeight)
        .filter((value) => Number.isFinite(value))
        .sort((left, right) => left - right);
      const contextCropWidth =
        professionalWidths[Math.floor(professionalWidths.length / 2)] ??
        normalizedCropWidth;
      const contextCropHeight =
        professionalHeights[Math.floor(professionalHeights.length / 2)] ?? 1;
      const automaticKeyframes = contextAwareKeyframes.length
        ? contextAwareKeyframes.map((frame) => ({
            ...frame,
            cropWidth: contextCropWidth,
            cropHeight: contextCropHeight,
            centerX: Math.min(
              1 - contextCropWidth / 2,
              Math.max(contextCropWidth / 2, frame.centerX)
            ),
            centerY: Math.min(
              1 - contextCropHeight / 2,
              Math.max(contextCropHeight / 2, frame.centerY ?? 0.5)
            ),
          }))
        : professionalPlan?.cropKeyframes.length
          ? professionalPlan.cropKeyframes
          : followActiveSpeaker
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
              );
      resolved.subjectCrop = {
        keyframes: mergeManualCropKeyframes(
          automaticKeyframes,
          request.reframe?.manualKeyframes
        ),
        planVersion:
          contextAwareKeyframes.length && analysis?.contextAwareFraming
            ? analysis.contextAwareFraming.version
            : professionalPlan?.version,
        style: professionalPlan?.style,
      };
      if (professionalPlan) warnings.push(...professionalPlan.warnings);
      } else {
        warnings.push(
          "No face track was available for Follow speaker, so Center Crop was used instead."
        );
        resolved.layout = "center_crop";
      }
    }
  }

  return {
    resolved,
    effectiveLayout: resolved.layout,
    faceAnalysisJobId,
    warnings,
    captionSafeZone: automaticRequest ? gameplayPlan?.captionSafeZone : undefined,
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
  const analysisJobId = options.faceAnalysisJobId ?? request.faceAnalysisJobId;
  const analysisJob = analysisJobId
    ? await prisma.faceAnalysisJob.findUnique({
        where: { id: analysisJobId },
        select: { resultJson: true },
      })
    : null;
  const storedAnalysis = parseStoredFaceAnalysisResult(analysisJob?.resultJson);
  const storedHasReliableFaceTracking = Boolean(
    storedAnalysis &&
      storedAnalysis.confidence >= 0.45 &&
      storedAnalysis.classification !== "no_face" &&
      storedAnalysis.classification !== "already_vertical" &&
      storedAnalysis.classification !== "gameplay_only" &&
      storedAnalysis.tracks.some((track) => track.points.length >= 3)
  );
  const recommendedLayout = storedAnalysis?.gameplayLayoutPlan
    ? verticalLayoutForAutomaticPlan(
        storedAnalysis.gameplayLayoutPlan.selectedFamily,
        storedAnalysis.recommendation?.layout,
        storedHasReliableFaceTracking
      )
    : storedAnalysis?.recommendation?.layout;
  const creatorCorrections = [
    ...(request.layout !== "auto" && request.layout !== recommendedLayout
      ? ["layout_changed"]
      : []),
    ...(request.reframe?.manualKeyframes?.length
      ? ["gameplay_crop_changed"]
      : []),
    ...(request.faceSelection.mode === "manual"
      ? ["webcam_repositioned"]
      : []),
    ...(request.pip?.position &&
    storedAnalysis?.gameplayLayoutPlan?.candidates.find(
      (candidate) =>
        candidate.id === storedAnalysis.gameplayLayoutPlan?.selectedCandidateId
    )?.pipPosition !== request.pip.position
      ? ["webcam_repositioned"]
      : []),
    ...((request.pip?.widthRatio != null ||
      request.stacked?.facecamHeightRatio != null) &&
    request.layout !== "auto"
      ? ["webcam_resized"]
      : []),
    ...(storedAnalysis?.gameplayLayoutPlan?.selectedFamily ===
      "dynamic_reaction" &&
    (request.layout !== "auto" || request.reframe?.reactionEmphasis === false)
      ? ["reaction_expansion_removed"]
      : []),
  ];
  const settingsJson = toJsonValue({
    stacked: request.stacked,
    pip: request.pip,
    subjectCrop: request.subjectCrop,
    reframe: request.reframe,
    centerCrop: request.centerCrop,
    captions: request.captions,
    layoutDna: storedAnalysis?.gameplayLayoutPlan
      ? {
          version: storedAnalysis.gameplayLayoutPlan.version,
          sourceClassification: storedAnalysis.classification,
          sourceDimensions: {
            width: storedAnalysis.sourceWidth,
            height: storedAnalysis.sourceHeight,
          },
          selectedFamily: storedAnalysis.gameplayLayoutPlan.selectedFamily,
          selectedCandidateId:
            storedAnalysis.gameplayLayoutPlan.selectedCandidateId,
          alternatives: storedAnalysis.gameplayLayoutPlan.candidates.map(
            (candidate) => ({
              id: candidate.id,
              family: candidate.family,
              score: candidate.score,
              valid: candidate.validation.valid,
            })
          ),
          gameplayRegionCount:
            storedAnalysis.gameplayImportanceMap?.regions.length ?? 0,
          importantGameplayRegions:
            storedAnalysis.gameplayImportanceMap?.regions.slice(0, 80),
          webcamRegion:
            bestEmbeddedFacecamCandidate([
              ...(storedAnalysis.primaryCandidate
                ? [storedAnalysis.primaryCandidate]
                : []),
              ...storedAnalysis.alternativeCandidates,
            ])?.rect ?? null,
          visiblePeople: storedAnalysis.tracks.length,
          splitRatio:
            storedAnalysis.gameplayLayoutPlan.candidates.find(
              (candidate) =>
                candidate.id ===
                storedAnalysis.gameplayLayoutPlan?.selectedCandidateId
            )?.splitRatio ?? null,
          pip: (() => {
            const selected =
              storedAnalysis.gameplayLayoutPlan?.candidates.find(
                (candidate) =>
                  candidate.id ===
                  storedAnalysis.gameplayLayoutPlan?.selectedCandidateId
              );
            return selected?.pipPosition
              ? {
                  position: selected.pipPosition,
                  widthRatio: selected.pipWidthRatio,
                }
              : null;
          })(),
          cropTrajectory:
            storedAnalysis.gameplayLayoutPlan.gameplayCropKeyframes,
          captionSafeZone:
            storedAnalysis.gameplayLayoutPlan.captionSafeZone,
          dynamicLayoutChanges: storedAnalysis.gameplayLayoutPlan.segments,
          analysisMetrics: storedAnalysis.gameplayMetrics,
          faceModelVersion: storedAnalysis.modelVersion,
          planConfidence: storedAnalysis.gameplayLayoutPlan.confidence,
          creatorCorrections: [...new Set(creatorCorrections)],
        }
      : undefined,
  }) as Prisma.InputJsonValue;

  const data = {
    streamSessionId: options.streamSessionId,
    faceAnalysisJobId: analysisJobId,
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

/** Rehydrate the persisted database fields into the request used by previews and renders. */
export function requestFromVerticalLayoutConfiguration(config: {
  layout: string;
  faceAnalysisJobId: string | null;
  faceSelectionMode: string;
  selectedTrackId: string | null;
  manualFaceRect: unknown;
  settingsJson: unknown;
}): VerticalLayoutRequest | null {
  const settings =
    config.settingsJson &&
    typeof config.settingsJson === "object" &&
    !Array.isArray(config.settingsJson)
      ? config.settingsJson
      : {};

  return parseVerticalLayoutRequest({
    ...settings,
    layout: config.layout,
    faceAnalysisJobId: config.faceAnalysisJobId ?? undefined,
    faceSelection: {
      mode: config.faceSelectionMode,
      trackId: config.selectedTrackId ?? undefined,
      manualRect: config.manualFaceRect ?? undefined,
    },
  });
}
