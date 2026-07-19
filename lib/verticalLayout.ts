import { z } from "zod";
import {
  expandFaceToFacecamCrop,
  medianRect,
  rectArea,
  rectCenter,
  type NormalizedRect,
} from "@/lib/normalizedRect";

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
  | "no_face";

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
};

export type FaceTrackPoint = {
  timestampSeconds: number;
  rect: NormalizedRect;
  confidence: number;
  mouthOpenRatio?: number;
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
  for (let i = 1; i < centers.length; i++) {
    movement += Math.hypot(
      centers[i]!.x - centers[i - 1]!.x,
      centers[i]!.y - centers[i - 1]!.y
    );
  }

  const last = points[points.length - 1]!.rect;
  const edgeDist = Math.min(
    last.x,
    last.y,
    1 - (last.x + last.width),
    1 - (last.y + last.height)
  );
  const edgeAffinity = Math.max(0, 1 - edgeDist * 4);

  // Speaking score: mouth-width variance when landmarks exist; otherwise a
  // soft fallback from face-height jitter (talking heads bob and open mouth).
  const mouthSamples = points
    .map((p) => p.mouthOpenRatio)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  let speakingScore = 0;
  if (mouthSamples.length >= 3) {
    const mean =
      mouthSamples.reduce((s, v) => s + v, 0) / mouthSamples.length;
    const variance =
      mouthSamples.reduce((s, v) => s + (v - mean) ** 2, 0) /
      mouthSamples.length;
    // Typical idle mouths sit near ~0.35–0.55; talking pushes variance up.
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

  return {
    persistence: sampleCount > 0 ? Math.min(1, points.length / sampleCount) : 0,
    averageConfidence: track.averageConfidence,
    positionStability,
    sizeStability,
    edgeAffinity,
    medianArea: areas.sort((a, b) => a - b)[Math.floor(areas.length / 2)] ?? 0,
    centerMovement: movement,
    speakingScore,
  };
}

/** Prefer the face that is most likely talking (for Follow speaker). */
export function scoreSpeakingSubject(metrics: FaceTrackMetrics): number {
  return (
    metrics.speakingScore * 0.55 +
    metrics.persistence * 0.25 +
    metrics.averageConfidence * 0.1 +
    Math.min(1, metrics.medianArea * 8) * 0.1
  );
}

export function scoreEmbeddedFacecam(metrics: FaceTrackMetrics): number {
  const w = FACE_SCORING_WEIGHTS;
  return (
    metrics.persistence * w.persistence +
    metrics.positionStability * w.positionStability +
    metrics.sizeStability * w.sizeStability +
    metrics.edgeAffinity * w.edgeAffinity +
    metrics.averageConfidence * w.averageConfidence
  );
}

export function classifySourceFromTracks(
  tracks: FaceTrack[],
  metricsById: Map<string, FaceTrackMetrics>
): { classification: FaceSourceClassification; confidence: number } {
  const meaningful = tracks.filter((t) => {
    const m = metricsById.get(t.id);
    return m && m.persistence >= 0.25 && m.averageConfidence >= 0.5;
  });

  if (meaningful.length === 0) {
    return { classification: "no_face", confidence: 0.7 };
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

  if (classification === "no_face" || !primary) {
    return {
      layout: "center_crop",
      reason: "No reliable facecam was detected. Center Crop is the safest option.",
      warnings,
    };
  }

  if (classification === "multiple_faces") {
    if (primary?.speakingScore != null && primary.speakingScore >= 0.25) {
      return {
        layout: "subject_aware_crop",
        reason:
          "Multiple faces were detected. Follow speaker will crop to the person who appears to be talking.",
        warnings,
      };
    }
    return {
      layout: "center_crop",
      reason:
        "Multiple faces were detected. Select a face, or use Follow speaker / Center Crop.",
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
