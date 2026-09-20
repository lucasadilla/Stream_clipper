import { z } from "zod";
import {
  expandFaceToFacecamCrop,
  medianRect,
  rectArea,
  rectCenter,
  type NormalizedRect,
} from "@/lib/normalizedRect";
import {
  REFRAME_STYLES,
  type CropInterpolation,
  type CropKeyframeReason,
  type VirtualCameraPlan,
} from "@/lib/professionalReframe";

export const VERTICAL_LAYOUTS = [
  "auto",
  "facecam_top_gameplay_bottom",
  "facecam_bottom_gameplay_top",
  "facecam_pip",
  "facecam_overlay", // legacy alias for facecam_pip
  "subject_aware_crop",
  "center_crop",
  "gameplay_full",
] as const;

export type VerticalLayout = (typeof VERTICAL_LAYOUTS)[number];

export type FaceSourceClassification =
  | "embedded_facecam"
  | "moving_subject"
  | "multiple_faces"
  | "no_face"
  | "gameplay_only"
  | "already_vertical"
  | "group_panel"
  | "obscured_face"
  | "intermittent_face";

export type FacecamQuality =
  | "good"
  | "acceptable"
  | "low_resolution"
  | "too_small";

export type HideOriginalFacecam = "none" | "blur" | "cover" | "crop_out";

export type FaceDetection = {
  timestampSeconds: number;
  rect: NormalizedRect;
  confidence: number;
  /** Mouth width / face width when the detector provides landmarks. */
  mouthOpenRatio?: number;
  /** Normalized motion inside the aligned mouth region for this sample. */
  speakingActivity?: number;
  /** Normalized audio energy near this video frame. */
  audioActivity?: number;
};

export type FaceTrackPoint = {
  timestampSeconds: number;
  rect: NormalizedRect;
  confidence: number;
  mouthOpenRatio?: number;
  speakingActivity?: number;
  audioActivity?: number;
};

export type FaceTrack = {
  id: string;
  points: FaceTrackPoint[];
  firstSeenSeconds: number;
  lastSeenSeconds: number;
  averageConfidence: number;
};

export type FaceTrackMetrics = {
  persistence: number;
  averageConfidence: number;
  positionStability: number;
  sizeStability: number;
  edgeAffinity: number;
  medianArea: number;
  centerMovement: number;
  /**
   * 0–1 score for how much the mouth moves over the track.
   * Higher ≈ more likely the person who is talking.
   */
  speakingScore: number;
  /** A face size that can survive a vertical crop without excessive enlargement. */
  sizeUseful: number;
  /** Central subject bias or a stable corner-facecam bias, whichever is stronger. */
  centralityOrFacecamBias: number;
  /** Rapid direction/size changes that look like detector noise. */
  jitterPenalty: number;
  /** Penalty for isolated, short-lived detections. */
  oneFramePopPenalty: number;
  /** Penalty for tiny transient faces commonly found in alerts, art, and UI. */
  uiFalsePositivePenalty: number;
};

export type FacecamCandidate = {
  trackId: string;
  /** Expanded facecam crop (head + shoulders + context). */
  rect: NormalizedRect;
  /** Raw median face box before expansion (for UI overlays). */
  faceRect?: NormalizedRect;
  confidence: number;
  sourceWidthPixels: number;
  sourceHeightPixels: number;
  quality: FacecamQuality;
  warnings: string[];
  /** Present when mouth landmarks were available during analysis. */
  speakingScore?: number;
};

/**
 * Gaming layouts need the stable embedded webcam, not an in-game character or
 * whichever detected face is currently speaking. Candidate confidence is the
 * embedded-facecam score produced from persistence, edge affinity and jitter.
 */
export function bestEmbeddedFacecamCandidate(
  candidates: Array<FacecamCandidate | null | undefined>
): FacecamCandidate | undefined {
  return candidates
    .filter((candidate): candidate is FacecamCandidate => Boolean(candidate))
    .slice()
    .sort((a, b) => {
      const confidenceDelta = b.confidence - a.confidence;
      if (Math.abs(confidenceDelta) > 0.001) return confidenceDelta;
      const bPixels = b.sourceWidthPixels * b.sourceHeightPixels;
      const aPixels = a.sourceWidthPixels * a.sourceHeightPixels;
      return bPixels - aPixels;
    })[0];
}

export type ScoredFaceTrack = {
  track: FaceTrack;
  metrics: FaceTrackMetrics;
};

/**
 * Keep the stable embedded webcam in the candidate set even when character
 * faces rank higher as active speakers. The primary candidate can still be the
 * speaker for talking-head layouts; gaming then selects the embedded candidate.
 */
export function selectFaceAnalysisCandidates(
  entries: ScoredFaceTrack[],
  preferSpeaker: boolean,
  limit = 4
): ScoredFaceTrack[] {
  const safeLimit = Math.max(1, Math.floor(limit));
  const speakerRanked = entries
    .slice()
    .sort(
      (a, b) => scoreSpeakingSubject(b.metrics) - scoreSpeakingSubject(a.metrics)
    );
  const embeddedRanked = entries
    .slice()
    .sort(
      (a, b) => scoreEmbeddedFacecam(b.metrics) - scoreEmbeddedFacecam(a.metrics)
    );
  if (!preferSpeaker) return embeddedRanked.slice(0, safeLimit);

  const selected: ScoredFaceTrack[] = [];
  const add = (entry: ScoredFaceTrack | undefined) => {
    if (!entry || selected.some((item) => item.track.id === entry.track.id)) return;
    if (selected.length < safeLimit) selected.push(entry);
  };

  // Reserve one slot for the best stable/edge-affine webcam candidate.
  speakerRanked.slice(0, Math.max(0, safeLimit - 1)).forEach(add);
  add(embeddedRanked[0]);
  speakerRanked.forEach(add);
  embeddedRanked.forEach(add);
  return selected.slice(0, safeLimit);
}

export type LayoutRecommendation = {
  layout: VerticalLayout;
  reason: string;
  warnings: string[];
};

export type FacecamAnalysisResult = {
  id?: string;
  sourceMediaId?: string;
  clipId?: string;
  classification: FaceSourceClassification;
  confidence: number;
  sampleFps: number;
  primaryCandidate?: FacecamCandidate;
  alternativeCandidates: FacecamCandidate[];
  tracks: FaceTrack[];
  recommendation: LayoutRecommendation;
  warnings: string[];
  modelName: string;
  modelVersion: string;
  /** Versioned, reproducible camera decisions shared by preview and render. */
  professionalPlan?: VirtualCameraPlan;
  createdAt?: string;
};

export const FACE_SCORING_WEIGHTS = {
  persistence: 0.4,
  positionStability: 0.25,
  sizeStability: 0.15,
  edgeAffinity: 0.1,
  averageConfidence: 0.1,
} as const;

export const FACE_ANALYSIS_CONFIG = {
  minConfidence: 0.55,
  centerMatchDistance: 0.08,
  sizeRatioMin: 0.5,
  sizeRatioMax: 2,
  trackGapSeconds: 2.5,
  embeddedMaxMedianArea: 0.12,
  movingMinMedianArea: 0.08,
  goodMinPixels: 280,
  acceptableMinPixels: 180,
  tooSmallMaxPixels: 120,
} as const;

const normalizedRectSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().gt(0).max(1),
  height: z.number().gt(0).max(1),
});

/** Layout + face-selection payload sent alongside a vertical render request. */
export const verticalLayoutRequestSchema = z.object({
  layout: z.enum(VERTICAL_LAYOUTS).default("auto"),
  faceAnalysisJobId: z.string().optional(),
  faceSelection: z
    .object({
      mode: z.enum(["auto", "manual"]).default("auto"),
      trackId: z.string().optional(),
      manualRect: normalizedRectSchema.optional(),
    })
    .default({ mode: "auto" }),
  stacked: z
    .object({
      facecamPosition: z.enum(["top", "bottom"]).default("top"),
      facecamHeightRatio: z.number().min(0.2).max(0.55).default(0.38),
      dividerSize: z.number().min(0).max(24).default(0),
      dividerColor: z.string().default("#000000"),
      hideOriginalFacecam: z
        .enum(["none", "blur", "cover", "crop_out"])
        .default("none"),
    })
    .optional(),
  pip: z
    .object({
      position: z
        .enum(["top_left", "top_right", "bottom_left", "bottom_right"])
        .default("top_right"),
      widthRatio: z.number().min(0.2).max(0.5).default(0.34),
      margin: z.number().min(0).max(0.12).default(0.04),
      borderSize: z.number().min(0).max(16).default(3),
      borderColor: z.string().default("#FFFFFF"),
      hideOriginalFacecam: z
        .enum(["none", "blur", "cover", "crop_out"])
        .default("none"),
    })
    .optional(),
  subjectCrop: z
    .object({
      smoothing: z.number().min(0).max(1).default(0.35),
      deadZoneRatio: z.number().min(0).max(0.8).default(0.5),
      maxPanSpeed: z.number().min(0.05).max(2).default(0.35),
      fallback: z.enum(["hold", "center"]).default("hold"),
    })
    .optional(),
  reframe: z
    .object({
      style: z.enum(REFRAME_STYLES).default("professional"),
      lockSubject: z.boolean().default(false),
      lockedTrackId: z.string().optional(),
      manualKeyframes: z
        .array(
          z.object({
            timestampSeconds: z.number().min(0),
            centerX: z.number().min(0).max(1),
            centerY: z.number().min(0).max(1),
            cropWidth: z.number().min(0.05).max(1),
            cropHeight: z.number().min(0.05).max(1),
            interpolation: z
              .enum(["hold", "ease_in_out", "linear", "cut"])
              .optional(),
          })
        )
        .max(120)
        .optional(),
    })
    .optional(),
  centerCrop: z
    .object({
      focalPointX: z.number().min(0).max(1).default(0.5),
      zoom: z.number().min(1).max(2).default(1),
      useBlurredBackground: z.boolean().default(false),
    })
    .optional(),
  captions: z
    .object({
      enabled: z.boolean().default(true),
      position: z.enum(["upper", "middle", "lower"]).default("lower"),
    })
    .optional(),
  preview: z.boolean().optional(),
});

export type VerticalLayoutRequest = z.infer<typeof verticalLayoutRequestSchema>;

export function parseVerticalLayoutRequest(
  value: unknown
): VerticalLayoutRequest | null {
  if (!value || typeof value !== "object") return null;
  const parsed = verticalLayoutRequestSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function resolveLayoutName(layout: VerticalLayout): VerticalLayout {
  if (layout === "facecam_overlay") return "facecam_pip";
  if (layout === "gameplay_full") return "center_crop";
  return layout;
}

export function classifyFacecamQuality(
  sourceWidth: number,
  sourceHeight: number,
  rect: NormalizedRect
): FacecamQuality {
  const w = sourceWidth * rect.width;
  const h = sourceHeight * rect.height;
  const minSide = Math.min(w, h);
  if (minSide < FACE_ANALYSIS_CONFIG.tooSmallMaxPixels) return "too_small";
  if (minSide < FACE_ANALYSIS_CONFIG.acceptableMinPixels) return "low_resolution";
  if (minSide < FACE_ANALYSIS_CONFIG.goodMinPixels) return "acceptable";
  return "good";
}

export function computeTrackMetrics(
  track: FaceTrack,
  sampleCount: number
): FaceTrackMetrics {
  const points = track.points;
  if (points.length === 0) {
    return {
      persistence: 0,
      averageConfidence: 0,
      positionStability: 0,
      sizeStability: 0,
      edgeAffinity: 0,
      medianArea: 0,
      centerMovement: 0,
      speakingScore: 0,
      sizeUseful: 0,
      centralityOrFacecamBias: 0,
      jitterPenalty: 1,
      oneFramePopPenalty: 1,
      uiFalsePositivePenalty: 1,
    };
  }

  const centers = points.map((p) => rectCenter(p.rect));
  const areas = points.map((p) => rectArea(p.rect));
  const widths = points.map((p) => p.rect.width);
  const heights = points.map((p) => p.rect.height);

  const meanCx = centers.reduce((s, c) => s + c.x, 0) / centers.length;
  const meanCy = centers.reduce((s, c) => s + c.y, 0) / centers.length;
  const posVar =
    centers.reduce(
      (s, c) => s + (c.x - meanCx) ** 2 + (c.y - meanCy) ** 2,
      0
    ) / centers.length;
  const positionStability = Math.max(0, 1 - Math.sqrt(posVar) * 8);

  const meanW = widths.reduce((s, v) => s + v, 0) / widths.length;
  const meanH = heights.reduce((s, v) => s + v, 0) / heights.length;
  const sizeVar =
    (widths.reduce((s, v) => s + (v - meanW) ** 2, 0) / widths.length +
      heights.reduce((s, v) => s + (v - meanH) ** 2, 0) / heights.length) /
    2;
  const sizeStability = Math.max(0, 1 - Math.sqrt(sizeVar) * 10);

  let movement = 0;
  const normalizedSteps: number[] = [];
  const sizeChanges: number[] = [];
  for (let i = 1; i < centers.length; i++) {
    const step = Math.hypot(
      centers[i]!.x - centers[i - 1]!.x,
      centers[i]!.y - centers[i - 1]!.y
    );
    movement += step;
    normalizedSteps.push(
      step / Math.max(0.035, Math.sqrt((areas[i]! + areas[i - 1]!) / 2))
    );
    sizeChanges.push(
      Math.abs(Math.log(Math.max(1e-6, areas[i]!) / Math.max(1e-6, areas[i - 1]!)))
    );
  }

  const edgeDistances = points
    .map((point) =>
      Math.min(
        point.rect.x,
        point.rect.y,
        1 - (point.rect.x + point.rect.width),
        1 - (point.rect.y + point.rect.height)
      )
    )
    .sort((a, b) => a - b);
  const edgeDist =
    edgeDistances[Math.floor(edgeDistances.length / 2)] ?? 0.5;
  const edgeAffinity = Math.max(0, 1 - edgeDist * 4);

  // Prefer aligned lower-face motion from the worker. Landmark variance is a
  // secondary signal because mouth-corner distance alone is not lip opening.
  const directSpeakingSamples = points
    .map((p) => p.speakingActivity)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
    .map((value) => Math.min(1, Math.max(0, value)));
  const mouthSamples = points
    .map((p) => p.mouthOpenRatio)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  let speakingScore = 0;
  if (directSpeakingSamples.length >= 2) {
    const sorted = [...directSpeakingSamples].sort((a, b) => a - b);
    const upperQuartile =
      sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.75))] ?? 0;
    const mean =
      directSpeakingSamples.reduce((sum, value) => sum + value, 0) /
      directSpeakingSamples.length;
    speakingScore = Math.min(1, upperQuartile * 0.7 + mean * 0.3);
  } else if (mouthSamples.length >= 3) {
    const mean =
      mouthSamples.reduce((s, v) => s + v, 0) / mouthSamples.length;
    const variance =
      mouthSamples.reduce((s, v) => s + (v - mean) ** 2, 0) /
      mouthSamples.length;
    speakingScore = Math.min(1, Math.sqrt(variance) * 12);
  } else if (heights.length >= 3) {
    const aspectDeltas: number[] = [];
    for (let i = 1; i < points.length; i++) {
      const prev = heights[i - 1]! / Math.max(1e-6, widths[i - 1]!);
      const next = heights[i]! / Math.max(1e-6, widths[i]!);
      aspectDeltas.push(Math.abs(next - prev));
    }
    const meanDelta =
      aspectDeltas.reduce((s, v) => s + v, 0) / aspectDeltas.length;
    speakingScore = Math.min(1, meanDelta * 25);
  }

  const sortedAreas = [...areas].sort((a, b) => a - b);
  const medianArea =
    sortedAreas[Math.floor(sortedAreas.length / 2)] ?? 0;
  const medianStep = normalizedSteps.length
    ? [...normalizedSteps].sort((a, b) => a - b)[
        Math.floor(normalizedSteps.length / 2)
      ] ?? 0
    : 0;
  const medianSizeChange = sizeChanges.length
    ? [...sizeChanges].sort((a, b) => a - b)[
        Math.floor(sizeChanges.length / 2)
      ] ?? 0
    : 0;
  const jitterPenalty = Math.min(
    1,
    Math.max(0, (medianStep - 0.08) * 2.8) +
      Math.max(0, (medianSizeChange - 0.09) * 2.2)
  );
  const persistence =
    sampleCount > 0 ? Math.min(1, points.length / sampleCount) : 0;
  const oneFramePopPenalty =
    points.length <= 1
      ? 1
      : points.length === 2
        ? 0.8
        : Math.max(0, (0.16 - persistence) / 0.16);
  const sizeUseful =
    medianArea < 0.0025
      ? Math.max(0, medianArea / 0.0025)
      : medianArea > 0.32
        ? Math.max(0.35, 1 - (medianArea - 0.32) * 1.8)
        : Math.min(1, 0.55 + Math.sqrt(medianArea) * 2.4);
  const centrality =
    centers.reduce(
      (sum, center) =>
        sum +
        Math.max(0, 1 - Math.hypot(center.x - 0.5, center.y - 0.48) / 0.68),
      0
    ) / centers.length;
  const facecamBias = edgeAffinity * positionStability * sizeStability;
  const centralityOrFacecamBias = Math.max(centrality, facecamBias);
  const uiFalsePositivePenalty = Math.min(
    1,
    (medianArea < 0.004 ? 0.5 : 0) +
      (persistence < 0.22 ? 0.35 : 0) +
      (sizeStability < 0.45 ? 0.25 : 0) +
      oneFramePopPenalty * 0.5
  );

  return {
    persistence,
    averageConfidence: track.averageConfidence,
    positionStability,
    sizeStability,
    edgeAffinity,
    medianArea,
    centerMovement: movement,
    speakingScore,
    sizeUseful,
    centralityOrFacecamBias,
    jitterPenalty,
    oneFramePopPenalty,
    uiFalsePositivePenalty,
  };
}

/** Prefer the face that is most likely talking (for Follow speaker). */
export function scoreSpeakingSubject(metrics: FaceTrackMetrics): number {
  return Math.min(
    1,
    Math.max(
      0,
      metrics.persistence * 0.38 +
        metrics.averageConfidence * 0.22 +
        metrics.speakingScore * 0.18 +
        metrics.sizeUseful * 0.12 +
        metrics.centralityOrFacecamBias * 0.1 -
        metrics.jitterPenalty * 0.25 -
        metrics.oneFramePopPenalty * 0.35 -
        metrics.uiFalsePositivePenalty * 0.2
    )
  );
}

export function scoreEmbeddedFacecam(metrics: FaceTrackMetrics): number {
  const w = FACE_SCORING_WEIGHTS;
  return Math.min(
    1,
    Math.max(
      0,
      metrics.persistence * w.persistence +
        metrics.positionStability * w.positionStability +
        metrics.sizeStability * w.sizeStability +
        metrics.edgeAffinity * w.edgeAffinity +
        metrics.averageConfidence * w.averageConfidence -
        metrics.jitterPenalty * 0.2 -
        metrics.oneFramePopPenalty * 0.35 -
        metrics.uiFalsePositivePenalty * 0.3
    )
  );
}

export function classifySourceFromTracks(
  tracks: FaceTrack[],
  metricsById: Map<string, FaceTrackMetrics>,
  source?: { width: number; height: number }
): { classification: FaceSourceClassification; confidence: number } {
  if (source && source.height > source.width * 1.2) {
    return { classification: "already_vertical", confidence: 0.98 };
  }
  const meaningful = tracks.filter((t) => {
    const m = metricsById.get(t.id);
    return (
      m &&
      m.persistence >= 0.2 &&
      m.averageConfidence >= 0.5 &&
      m.oneFramePopPenalty < 0.75 &&
      m.uiFalsePositivePenalty < 0.9
    );
  });

  if (meaningful.length === 0) {
    const intermittent = tracks
      .map((track) => ({ track, metrics: metricsById.get(track.id) }))
      .filter(
        (item): item is { track: FaceTrack; metrics: FaceTrackMetrics } =>
          Boolean(
            item.metrics &&
              item.metrics.persistence >= 0.08 &&
              item.metrics.averageConfidence >= 0.48 &&
              item.metrics.oneFramePopPenalty < 0.95
          )
      )
      .sort((a, b) => b.metrics.persistence - a.metrics.persistence)[0];
    if (intermittent) {
      return {
        classification: "intermittent_face",
        confidence: Math.min(
          0.62,
          intermittent.metrics.persistence * 0.7 +
            intermittent.metrics.averageConfidence * 0.3
        ),
      };
    }
    return { classification: "no_face", confidence: 0.7 };
  }

  if (meaningful.length >= 3) {
    const panelTracks = meaningful.filter(
      (track) => (metricsById.get(track.id)?.persistence ?? 0) >= 0.38
    );
    if (panelTracks.length >= 3) {
      return { classification: "group_panel", confidence: 0.82 };
    }
  }

  if (meaningful.length >= 2) {
    const sorted = [...meaningful].sort(
      (a, b) =>
        (metricsById.get(b.id)?.persistence ?? 0) -
        (metricsById.get(a.id)?.persistence ?? 0)
    );
    const top = metricsById.get(sorted[0]!.id)!;
    const second = metricsById.get(sorted[1]!.id)!;
    if (second.persistence > top.persistence * 0.55) {
      return { classification: "multiple_faces", confidence: 0.75 };
    }
  }

  const best = meaningful
    .map((t) => ({ track: t, metrics: metricsById.get(t.id)! }))
    .sort((a, b) => scoreEmbeddedFacecam(b.metrics) - scoreEmbeddedFacecam(a.metrics))[0]!;

  const m = best.metrics;
  if (m.persistence < 0.46) {
    return {
      classification: "intermittent_face",
      confidence: Math.min(0.7, m.persistence * 0.8 + m.averageConfidence * 0.2),
    };
  }
  if (m.averageConfidence < 0.6 || m.jitterPenalty > 0.62) {
    return {
      classification: "obscured_face",
      confidence: Math.min(0.62, m.averageConfidence),
    };
  }
  const embeddedScore = scoreEmbeddedFacecam(m);
  const isEmbedded =
    embeddedScore >= 0.55 &&
    m.positionStability >= 0.55 &&
    m.medianArea <= FACE_ANALYSIS_CONFIG.embeddedMaxMedianArea;

  if (isEmbedded) {
    return { classification: "embedded_facecam", confidence: embeddedScore };
  }

  if (
    m.medianArea >= FACE_ANALYSIS_CONFIG.movingMinMedianArea ||
    m.centerMovement > 0.25
  ) {
    return {
      classification: "moving_subject",
      confidence: Math.min(0.9, 0.45 + m.persistence * 0.4),
    };
  }

  return {
    classification: embeddedScore >= 0.4 ? "embedded_facecam" : "no_face",
    confidence: embeddedScore,
  };
}

export function recommendVerticalLayout(
  classification: FaceSourceClassification,
  primary?: FacecamCandidate
): LayoutRecommendation {
  const warnings = [...(primary?.warnings ?? [])];

  if (
    classification === "no_face" ||
    classification === "gameplay_only" ||
    classification === "group_panel" ||
    classification === "already_vertical" ||
    !primary
  ) {
    return {
      layout: "center_crop",
      reason:
        classification === "already_vertical"
          ? "The source is already vertical, so only minimal centered reframing is needed."
          : classification === "group_panel"
            ? "Several persistent faces share the frame, so a stable wide crop avoids distracting subject hunting."
            : "No reliable facecam was detected. Center Crop is the safest option.",
      warnings,
    };
  }

  if (classification === "intermittent_face" && primary.confidence < 0.45) {
    return {
      layout: "center_crop",
      reason:
        "The face appears too inconsistently for reliable tracking, so a stable centered crop is safer.",
      warnings,
    };
  }

  if (classification === "intermittent_face" || classification === "obscured_face") {
    return {
      layout: "subject_aware_crop",
      reason:
        "A usable but imperfect face track was found. Conservative framing will hold the last good composition through brief losses.",
      warnings,
    };
  }

  if (classification === "multiple_faces") {
    return {
      layout: "subject_aware_crop",
      reason:
        "Multiple faces were detected. Follow speaker will switch framing as the active speaker changes.",
      warnings,
    };
  }

  if (classification === "moving_subject") {
    return {
      layout: "subject_aware_crop",
      reason:
        "A person fills most of the frame. Follow speaker will keep their face in view.",
      warnings,
    };
  }

  if (primary.quality === "too_small" || primary.quality === "low_resolution") {
    warnings.push(
      "The detected facecam may appear blurry when enlarged. Picture in Picture is recommended."
    );
    return {
      layout: "facecam_pip",
      reason:
        "A stable facecam was detected, but it is small in the source. Picture in Picture keeps it readable.",
      warnings,
    };
  }

  return {
    layout: "facecam_top_gameplay_bottom",
    reason:
      "A stable facecam was detected and is large enough for a stacked Facecam + Gameplay layout.",
    warnings,
  };
}

export function candidateFromTrack(
  track: FaceTrack,
  metrics: FaceTrackMetrics,
  sourceWidth: number,
  sourceHeight: number
): FacecamCandidate {
  // Median coordinates across the clip keep occasional false detections from
  // moving the crop; the median face box is then expanded to a usable crop.
  const medianFace =
    medianRect(track.points.map((p) => p.rect)) ?? track.points[0]!.rect;
  const crop = expandFaceToFacecamCrop(medianFace);

  const quality = classifyFacecamQuality(sourceWidth, sourceHeight, crop);
  const warnings: string[] = [];
  if (quality === "low_resolution" || quality === "too_small") {
    warnings.push(
      `The detected facecam is about ${Math.round(sourceWidth * crop.width)}×${Math.round(sourceHeight * crop.height)} pixels and may look blurry when enlarged.`
    );
  }

  return {
    trackId: track.id,
    rect: crop,
    faceRect: medianFace,
    confidence: scoreEmbeddedFacecam(metrics),
    sourceWidthPixels: Math.round(sourceWidth * crop.width),
    sourceHeightPixels: Math.round(sourceHeight * crop.height),
    quality,
    warnings,
    speakingScore: metrics.speakingScore,
  };
}

// ---------------------------------------------------------------------------
// Subject-aware crop planning
// ---------------------------------------------------------------------------

export type SubjectCropKeyframe = {
  timestampSeconds: number;
  /** Normalized horizontal center of the crop window (0..1). */
  centerX: number;
  /** Normalized vertical center. Older plans safely default to 0.5. */
  centerY?: number;
  cropWidth?: number;
  cropHeight?: number;
  interpolation?: CropInterpolation;
  reason?: CropKeyframeReason;
  subjectTrackId?: string;
  confidence?: number;
};

export type ActiveSpeakerCropConfig = {
  /** Minimum time a challenger must look active before the crop switches. */
  switchConfirmationSeconds: number;
  /** Avoid rapid cuts back and forth during interruptions and laughter. */
  minimumSpeakerHoldSeconds: number;
  /** Local mouth-motion advantage required to leave the current speaker. */
  switchScoreMargin: number;
  /** Window used to measure mouth movement around each sampled instant. */
  activityWindowSeconds: number;
};

export const DEFAULT_ACTIVE_SPEAKER_CROP_CONFIG: ActiveSpeakerCropConfig = {
  switchConfirmationSeconds: 0.5,
  minimumSpeakerHoldSeconds: 1.1,
  switchScoreMargin: 0.055,
  activityWindowSeconds: 0.7,
};

export interface SubjectCropConfig {
  /** EMA factor 0..1 — higher follows the subject faster. */
  smoothing: number;
  /** Fraction of the crop width the subject may drift before the crop moves. */
  deadZoneRatio: number;
  /** Max crop-center movement per second (normalized units). */
  maxPanSpeed: number;
  /** What to do when the face disappears for a while. */
  fallback: "hold" | "center";
  /** Seconds a face may vanish before the fallback kicks in. */
  holdSeconds: number;
  /** Minimum spacing between emitted keyframes (avoids hundreds of segments). */
  minKeyframeSpacingSeconds: number;
  /** Movement below this is dropped so still shots produce a static crop. */
  minMovement: number;
}

export const DEFAULT_SUBJECT_CROP_CONFIG: SubjectCropConfig = {
  smoothing: 0.35,
  deadZoneRatio: 0.5,
  maxPanSpeed: 0.35,
  fallback: "hold",
  holdSeconds: 2,
  minKeyframeSpacingSeconds: 0.75,
  minMovement: 0.015,
};

/**
 * Turn raw track points into a smoothed, sparse crop plan for a moving
 * subject. Applies an exponential moving average, a central dead zone and a
 * max pan speed so the crop never jumps to a new detection. Gaps shorter than
 * holdSeconds keep the last position; longer gaps ease toward the fallback.
 */
export function buildSubjectCropPlan(
  points: FaceTrackPoint[],
  clipStartSeconds: number,
  clipEndSeconds: number,
  cropWidthRatio: number,
  config: Partial<SubjectCropConfig> = {}
): SubjectCropKeyframe[] {
  const cfg = { ...DEFAULT_SUBJECT_CROP_CONFIG, ...config };
  const duration = clipEndSeconds - clipStartSeconds;
  if (duration <= 0) return [{ timestampSeconds: 0, centerX: 0.5 }];

  const sorted = [...points]
    .filter(
      (p) =>
        p.timestampSeconds >= clipStartSeconds - 0.5 &&
        p.timestampSeconds <= clipEndSeconds + 0.5
    )
    .sort((a, b) => a.timestampSeconds - b.timestampSeconds);

  if (sorted.length === 0) return [{ timestampSeconds: 0, centerX: 0.5 }];

  const deadZoneHalf = (cropWidthRatio * cfg.deadZoneRatio) / 2;
  let cropCenter = rectCenter(sorted[0]!.rect).x;
  let lastSeen = sorted[0]!.timestampSeconds;
  let pointIndex = 0;

  const smoothed: SubjectCropKeyframe[] = [];
  const step = 0.25; // internal simulation resolution
  for (let t = clipStartSeconds; t <= clipEndSeconds + 1e-6; t += step) {
    // Latest detection at or before t.
    while (
      pointIndex + 1 < sorted.length &&
      sorted[pointIndex + 1]!.timestampSeconds <= t
    ) {
      pointIndex++;
    }
    const current = sorted[pointIndex]!;
    const visible = t - current.timestampSeconds <= cfg.holdSeconds;

    let target = cropCenter;
    if (visible && current.timestampSeconds <= t + 1e-6) {
      lastSeen = current.timestampSeconds;
      const subjectX = rectCenter(current.rect).x;
      // Dead zone: only move when the subject leaves the center region.
      if (Math.abs(subjectX - cropCenter) > deadZoneHalf) {
        target = subjectX;
      }
    } else if (t - lastSeen > cfg.holdSeconds && cfg.fallback === "center") {
      target = 0.5;
    }

    // EMA toward target, clamped by max pan speed.
    const desired = cropCenter + (target - cropCenter) * cfg.smoothing;
    const maxDelta = cfg.maxPanSpeed * step;
    const delta = Math.max(-maxDelta, Math.min(maxDelta, desired - cropCenter));
    cropCenter = Math.min(
      1 - cropWidthRatio / 2,
      Math.max(cropWidthRatio / 2, cropCenter + delta)
    );
    smoothed.push({
      timestampSeconds: Math.max(0, t - clipStartSeconds),
      centerX: cropCenter,
    });
  }

  // Sparsify: keep keyframes only where movement is meaningful, respecting a
  // minimum spacing so the FFmpeg expression stays small.
  const keyframes: SubjectCropKeyframe[] = [smoothed[0]!];
  for (const frame of smoothed.slice(1)) {
    const last = keyframes[keyframes.length - 1]!;
    if (
      frame.timestampSeconds - last.timestampSeconds >=
        cfg.minKeyframeSpacingSeconds &&
      Math.abs(frame.centerX - last.centerX) >= cfg.minMovement
    ) {
      keyframes.push(frame);
    }
  }
  const lastSmoothed = smoothed[smoothed.length - 1]!;
  if (
    keyframes[keyframes.length - 1]!.timestampSeconds <
    lastSmoothed.timestampSeconds - 0.5
  ) {
    keyframes.push(lastSmoothed);
  }

  // Hard cap keeps the crop expression a manageable size for very long clips.
  const MAX_KEYFRAMES = 60;
  if (keyframes.length > MAX_KEYFRAMES) {
    const stride = Math.ceil(keyframes.length / MAX_KEYFRAMES);
    const reduced = keyframes.filter((_, i) => i % stride === 0);
    if (reduced[reduced.length - 1] !== keyframes[keyframes.length - 1]) {
      reduced.push(keyframes[keyframes.length - 1]!);
    }
    return reduced;
  }
  return keyframes;
}

function closestTrackPoint(
  track: FaceTrack,
  timestampSeconds: number,
  maxDistanceSeconds = 0.55
): FaceTrackPoint | undefined {
  let closest: FaceTrackPoint | undefined;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const point of track.points) {
    const distance = Math.abs(point.timestampSeconds - timestampSeconds);
    if (distance < closestDistance) {
      closest = point;
      closestDistance = distance;
    }
  }
  return closestDistance <= maxDistanceSeconds ? closest : undefined;
}

function mouthActivityAt(
  track: FaceTrack,
  timestampSeconds: number,
  windowSeconds: number
): number {
  const values = track.points
    .filter(
      (point) =>
        Math.abs(point.timestampSeconds - timestampSeconds) <= windowSeconds &&
        typeof point.mouthOpenRatio === "number" &&
        Number.isFinite(point.mouthOpenRatio)
    )
    .map((point) => point.mouthOpenRatio as number);
  if (values.length < 3) return 0;

  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    values.length;
  const range = Math.max(...values) - Math.min(...values);
  return Math.min(1, Math.sqrt(variance) * 10 + range * 2.5);
}

/**
 * Build an editorial crop for conversations with multiple visible people.
 *
 * The plan uses local mouth motion instead of one whole-clip "best face".
 * Hysteresis and a minimum hold prevent rapid cuts during pauses, crosstalk,
 * laughter, or noisy landmark detections.
 */
export function buildActiveSpeakerCropPlan(
  tracks: FaceTrack[],
  clipStartSeconds: number,
  clipEndSeconds: number,
  cropWidthRatio: number,
  config: Partial<ActiveSpeakerCropConfig> = {}
): SubjectCropKeyframe[] {
  const cfg = { ...DEFAULT_ACTIVE_SPEAKER_CROP_CONFIG, ...config };
  const eligible = tracks
    .map((track) => ({
      track,
      points: track.points.filter(
        (point) =>
          point.timestampSeconds >= clipStartSeconds - 0.5 &&
          point.timestampSeconds <= clipEndSeconds + 0.5
      ),
    }))
    .filter(({ points }) => points.length >= 3);

  if (eligible.length < 2) {
    const fallback = eligible[0]?.points ?? [];
    return buildSubjectCropPlan(
      fallback,
      clipStartSeconds,
      clipEndSeconds,
      cropWidthRatio
    );
  }

  const globalActivity = new Map(
    eligible.map(({ track, points }) => {
      const ratios = points
        .map((point) => point.mouthOpenRatio)
        .filter(
          (value): value is number =>
            typeof value === "number" && Number.isFinite(value)
        );
      const range =
        ratios.length >= 3 ? Math.max(...ratios) - Math.min(...ratios) : 0;
      return [
        track.id,
        range * 2 + points.length / Math.max(1, eligible[0]!.points.length),
      ];
    })
  );

  let activeId = [...eligible]
    .sort(
      (a, b) =>
        (globalActivity.get(b.track.id) ?? 0) -
        (globalActivity.get(a.track.id) ?? 0)
    )[0]!.track.id;
  let activeSince = clipStartSeconds;
  let challengerId: string | null = null;
  let challengerSince = clipStartSeconds;
  const selectedPoints: FaceTrackPoint[] = [];

  const step = 0.25;
  for (let t = clipStartSeconds; t <= clipEndSeconds + 1e-6; t += step) {
    const scored = eligible
      .flatMap(({ track }) => {
        const point = closestTrackPoint(track, t);
        if (!point) return [];
        const activity = mouthActivityAt(
          track,
          t,
          cfg.activityWindowSeconds
        );
        const area = rectArea(point.rect);
        return [
          {
            track,
            point,
            activity,
            score:
              activity * 0.78 +
              point.confidence * 0.12 +
              Math.min(1, area * 10) * 0.1,
          },
        ];
      })
      .sort((a, b) => b.score - a.score);

    if (scored.length === 0) continue;
    const current = scored.find((item) => item.track.id === activeId);
    const best = scored[0]!;
    const currentScore = current?.score ?? 0;
    const hasSpeechEvidence = best.activity >= 0.035;
    const canLeave =
      t - activeSince >= cfg.minimumSpeakerHoldSeconds &&
      best.track.id !== activeId &&
      hasSpeechEvidence &&
      best.score >= currentScore + cfg.switchScoreMargin;

    if (canLeave) {
      if (challengerId !== best.track.id) {
        challengerId = best.track.id;
        challengerSince = t;
      } else if (t - challengerSince >= cfg.switchConfirmationSeconds) {
        activeId = best.track.id;
        activeSince = t;
        challengerId = null;
      }
    } else {
      challengerId = null;
    }

    const active =
      scored.find((item) => item.track.id === activeId) ?? current ?? best;
    selectedPoints.push({
      ...active.point,
      timestampSeconds: t,
    });
  }

  return buildSubjectCropPlan(
    selectedPoints,
    clipStartSeconds,
    clipEndSeconds,
    cropWidthRatio,
    {
      smoothing: 0.28,
      deadZoneRatio: 0.2,
      maxPanSpeed: 0.55,
      fallback: "hold",
      holdSeconds: 2.5,
      minKeyframeSpacingSeconds: 0.5,
      minMovement: 0.012,
    }
  );
}

// ---------------------------------------------------------------------------
// Caption safe zones
// ---------------------------------------------------------------------------

export type CaptionSafeZone = {
  /** Caption anchor (matches CaptionVerticalPosition). */
  vertical: "top" | "center" | "bottom";
  /** Offset from the anchored edge as % of output height. */
  verticalOffsetPercent: number;
};

/**
 * Where captions should sit for each layout so they never cover the facecam
 * panel / PiP window or the platform bottom controls.
 */
export function captionSafeZoneForLayout(options: {
  layout: VerticalLayout;
  captionPosition?: "upper" | "middle" | "lower";
  stackedFacecamPosition?: "top" | "bottom";
  stackedFacecamHeightRatio?: number;
  pipPosition?: "top_left" | "top_right" | "bottom_left" | "bottom_right";
}): CaptionSafeZone {
  const layout = resolveLayoutName(options.layout);
  const position = options.captionPosition ?? "lower";

  if (
    layout === "facecam_top_gameplay_bottom" ||
    layout === "facecam_bottom_gameplay_top"
  ) {
    const facecamTop = (options.stackedFacecamPosition ?? "top") === "top";
    const facecamRatio = options.stackedFacecamHeightRatio ?? 0.38;
    if (position === "middle") {
      // "Between panels" — anchor at the divider line.
      return {
        vertical: "top",
        verticalOffsetPercent: Math.round(
          (facecamTop ? facecamRatio : 1 - facecamRatio) * 100
        ),
      };
    }
    // Lower gameplay area, still above platform controls. When the facecam is
    // at the bottom, captions move up so they stay on the gameplay panel.
    return facecamTop
      ? { vertical: "bottom", verticalOffsetPercent: 13 }
      : {
          vertical: "bottom",
          verticalOffsetPercent: Math.round(facecamRatio * 100) + 5,
        };
  }

  if (layout === "facecam_pip") {
    const pip = options.pipPosition ?? "top_right";
    if (pip === "bottom_left" || pip === "bottom_right") {
      // Keep captions clear of a bottom PiP window.
      return { vertical: "bottom", verticalOffsetPercent: 32 };
    }
    return { vertical: "bottom", verticalOffsetPercent: 13 };
  }

  // Subject crop / center crop: ~70-80% down the frame with bottom margin.
  if (position === "upper") return { vertical: "top", verticalOffsetPercent: 12 };
  if (position === "middle") return { vertical: "center", verticalOffsetPercent: 0 };
  return { vertical: "bottom", verticalOffsetPercent: 13 };
}
