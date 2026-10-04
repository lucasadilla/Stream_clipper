import {
  normalizeRect,
  rectArea,
  rectCenter,
  rectIoU,
  type NormalizedRect,
} from "@/lib/normalizedRect";
import type { CropInterpolation } from "@/lib/professionalReframe";
import type {
  CursorAction,
  VisualAttentionSource,
  VisualLayoutHint,
} from "@/lib/visualAnalysis";
import type {
  FaceSourceClassification,
  FaceTrack,
  FacecamCandidate,
  SubjectCropKeyframe,
  VerticalLayout,
} from "@/lib/verticalLayout";

export const GAMEPLAY_LAYOUT_VERSION = "gameplay-layout-v2";

export type GameplayImportanceCategory =
  | "action"
  | "visual_focus"
  | "hud"
  | "outcome"
  | "context";

export interface GameplaySignalRegion {
  rect: NormalizedRect;
  strength: number;
  confidence: number;
  motion?: number;
  detail?: number;
  category: GameplayImportanceCategory;
}

export interface GameplaySignal {
  timestampSeconds: number;
  sceneChange?: boolean;
  regions: GameplaySignalRegion[];
}

export interface GameplayImportanceRegion {
  id: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  rect: NormalizedRect;
  category: GameplayImportanceCategory;
  strength: number;
  confidence: number;
  label?: string;
  attentionSource?: VisualAttentionSource;
  cursorAction?: CursorAction;
  layoutHint?: VisualLayoutHint;
  evidence: string[];
}

export interface GameplayImportanceMap {
  version: typeof GAMEPLAY_LAYOUT_VERSION;
  clipStartSeconds: number;
  clipEndSeconds: number;
  sourceWidth: number;
  sourceHeight: number;
  regions: GameplayImportanceRegion[];
  sceneChanges: number[];
  confidence: number;
  temporalCoverage: number;
  conservativeFallback: boolean;
}

export type GameplayLayoutFamily =
  | "stacked"
  | "pip"
  | "dynamic_reaction"
  | "gameplay_only"
  | "conservative";

export interface GameplayLayoutValidation {
  valid: boolean;
  hardFailures: string[];
  warnings: string[];
  gameplayCoverage: number;
  faceVisibility: number;
  captionSafety: number;
  sourceQuality: number;
  temporalStability: number;
}

export interface GameplayLayoutCandidate {
  id: string;
  family: GameplayLayoutFamily;
  score: number;
  reason: string;
  splitRatio?: number;
  pipPosition?: "top_left" | "top_right" | "bottom_left" | "bottom_right";
  pipWidthRatio?: number;
  gameplayCropWidth: number;
  captionSafeZone: {
    vertical: "top" | "center" | "bottom";
    verticalOffsetPercent: number;
  };
  validation: GameplayLayoutValidation;
}

export interface GameplayLayoutSegment {
  id: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  family: GameplayLayoutFamily;
  transitionIn: "start" | "cut" | "ease";
  reason: string;
}

export interface GameplayLayoutPlan {
  version: typeof GAMEPLAY_LAYOUT_VERSION;
  selectedFamily: GameplayLayoutFamily;
  selectedCandidateId: string;
  reason: string;
  candidates: GameplayLayoutCandidate[];
  segments: GameplayLayoutSegment[];
  gameplayCropKeyframes: SubjectCropKeyframe[];
  captionSafeZone: GameplayLayoutCandidate["captionSafeZone"];
  confidence: number;
  warnings: string[];
}

export interface GameplayVisualEvent {
  startTimeSeconds: number;
  endTimeSeconds: number;
  type: string;
  score: number;
  rawData?: unknown;
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function intersectionArea(a: NormalizedRect, b: NormalizedRect): number {
  const width = Math.max(
    0,
    Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  );
  const height = Math.max(
    0,
    Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  );
  return width * height;
}

function overlapFraction(inner: NormalizedRect, viewport: NormalizedRect): number {
  return clamp(intersectionArea(inner, viewport) / Math.max(1e-6, rectArea(inner)));
}

function weightedMean(values: Array<{ value: number; weight: number }>): number {
  const total = values.reduce((sum, item) => sum + item.weight, 0);
  if (total <= 0) return 0;
  return values.reduce((sum, item) => sum + item.value * item.weight, 0) / total;
}

function mergeImportanceRegions(
  regions: GameplayImportanceRegion[],
  maximumGapSeconds: number
): GameplayImportanceRegion[] {
  const merged: GameplayImportanceRegion[] = [];
  for (const region of regions.sort((a, b) => a.startTimeSeconds - b.startTimeSeconds)) {
    const previous = [...merged]
      .reverse()
      .find(
        (candidate) =>
          candidate.category === region.category &&
          (!candidate.attentionSource ||
            !region.attentionSource ||
            candidate.attentionSource === region.attentionSource) &&
          region.startTimeSeconds - candidate.endTimeSeconds <= maximumGapSeconds &&
          rectIoU(candidate.rect, region.rect) >= 0.35
      );
    if (!previous) {
      merged.push({ ...region, evidence: [...region.evidence] });
      continue;
    }
    const previousWeight = Math.max(0.01, previous.strength * previous.confidence);
    const regionWeight = Math.max(0.01, region.strength * region.confidence);
    const totalWeight = previousWeight + regionWeight;
    previous.rect = normalizeRect({
      x: (previous.rect.x * previousWeight + region.rect.x * regionWeight) / totalWeight,
      y: (previous.rect.y * previousWeight + region.rect.y * regionWeight) / totalWeight,
      width:
        (previous.rect.width * previousWeight + region.rect.width * regionWeight) /
        totalWeight,
      height:
        (previous.rect.height * previousWeight + region.rect.height * regionWeight) /
        totalWeight,
    }) ?? previous.rect;
    previous.endTimeSeconds = Math.max(previous.endTimeSeconds, region.endTimeSeconds);
    previous.strength = Math.max(previous.strength, region.strength);
    previous.confidence = clamp(
      (previous.confidence * previousWeight + region.confidence * regionWeight) /
        totalWeight
    );
    previous.label = previous.label ?? region.label;
    previous.attentionSource =
      previous.attentionSource ?? region.attentionSource;
    previous.cursorAction = previous.cursorAction ?? region.cursorAction;
    previous.layoutHint = previous.layoutHint ?? region.layoutHint;
    previous.evidence = [...new Set([...previous.evidence, ...region.evidence])].slice(0, 4);
  }
  return merged.map((region, index) => ({ ...region, id: `importance-${index + 1}` }));
}

function regionsFromVisualEvent(event: GameplayVisualEvent): GameplayImportanceRegion[] {
  const raw =
    event.rawData && typeof event.rawData === "object"
      ? (event.rawData as Record<string, unknown>)
      : null;
  const regionEntries: Array<{
    value: unknown;
    startTimeSeconds: number;
    endTimeSeconds: number;
    evidence: string;
    confidence?: number;
    attentionSource?: VisualAttentionSource;
    cursorAction?: CursorAction;
    layoutHint?: VisualLayoutHint;
  }> = (Array.isArray(raw?.importanceRegions) ? raw.importanceRegions : []).map(
    (value) => ({
      value,
      startTimeSeconds: event.startTimeSeconds,
      endTimeSeconds: event.endTimeSeconds,
      evidence: `visual_event:${event.type}`,
    })
  );
  const context =
    raw?.context && typeof raw.context === "object"
      ? (raw.context as Record<string, unknown>)
      : null;
  for (const contextEvent of Array.isArray(context?.events)
    ? context.events
    : []) {
    if (!contextEvent || typeof contextEvent !== "object") continue;
    const item = contextEvent as Record<string, unknown>;
    const time = Number(item.timeSeconds);
    if (!Number.isFinite(time)) continue;
    const regions = Array.isArray(item.importanceRegions)
      ? item.importanceRegions
      : [];
    for (const value of regions) {
      const region =
        value && typeof value === "object"
          ? (value as Record<string, unknown>)
          : null;
      const attentionSource =
        region?.attentionSource === "subject" ||
        region?.attentionSource === "speaker" ||
        region?.attentionSource === "cursor_target" ||
        region?.attentionSource === "interface" ||
        region?.attentionSource === "object" ||
        region?.attentionSource === "text" ||
        region?.attentionSource === "result"
          ? region.attentionSource
          : undefined;
      const layoutHint =
        item.layoutHint === "single_focus" ||
        item.layoutHint === "speaker_focus" ||
        item.layoutHint === "screen_focus" ||
        item.layoutHint === "screen_with_speaker" ||
        item.layoutHint === "wide_context"
          ? item.layoutHint
          : undefined;
      regionEntries.push({
        value,
        startTimeSeconds: Math.max(event.startTimeSeconds, time - 0.75),
        endTimeSeconds: Math.min(event.endTimeSeconds, time + 0.75),
        evidence: `multimodal_context:${String(item.type ?? "context")}`,
        confidence: Number.isFinite(Number(item.confidence))
          ? Number(item.confidence)
          : undefined,
        attentionSource,
        layoutHint,
      });
    }

    const cursor =
      item.cursor && typeof item.cursor === "object"
        ? (item.cursor as Record<string, unknown>)
        : null;
    const cursorPoint =
      cursor?.point && typeof cursor.point === "object"
        ? (cursor.point as Record<string, unknown>)
        : null;
    const cursorAction =
      cursor?.action === "pointing" ||
      cursor?.action === "clicking" ||
      cursor?.action === "dragging" ||
      cursor?.action === "moving" ||
      cursor?.action === "idle"
        ? cursor.action
        : undefined;
    const cursorConfidence = Number(cursor?.confidence);
    if (
      cursorAction &&
      cursorAction !== "idle" &&
      Number.isFinite(cursorConfidence) &&
      cursorConfidence >= 0.62 &&
      Number.isFinite(Number(cursorPoint?.x)) &&
      Number.isFinite(Number(cursorPoint?.y))
    ) {
      const suppliedTarget =
        cursor?.targetRect && typeof cursor.targetRect === "object"
          ? normalizeRect(cursor.targetRect as NormalizedRect)
          : null;
      const pointX = clamp(Number(cursorPoint?.x));
      const pointY = clamp(Number(cursorPoint?.y));
      const targetRect =
        suppliedTarget ??
        normalizeRect({
          x: pointX - 0.12,
          y: pointY - 0.1,
          width: 0.24,
          height: 0.2,
        });
      if (targetRect) {
        regionEntries.push({
          value: {
            rect: targetRect,
            category: "visual_focus",
            strength: Math.max(0.68, cursorConfidence * 0.92),
            label: "Cursor target",
            attentionSource: "cursor_target",
          },
          startTimeSeconds: Math.max(event.startTimeSeconds, time - 0.75),
          endTimeSeconds: Math.min(event.endTimeSeconds, time + 0.75),
          evidence: `multimodal_context:${String(item.type ?? "context")}`,
          confidence: Math.min(cursorConfidence, Number(item.confidence ?? 1)),
          attentionSource: "cursor_target",
          cursorAction,
          layoutHint:
            item.layoutHint === "screen_with_speaker"
              ? "screen_with_speaker"
              : "screen_focus",
        });
      }
    }
  }
  const parsed = regionEntries.flatMap((entry, index) => {
    const value = entry.value;
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>;
    const rectValue = item.rect as NormalizedRect | undefined;
    const rect = rectValue ? normalizeRect(rectValue) : null;
    if (!rect) return [];
    const category: GameplayImportanceCategory =
      item.category === "hud" ||
      item.category === "outcome" ||
      item.category === "action" ||
      item.category === "visual_focus"
        ? item.category
        : "context";
    const attentionSource =
      entry.attentionSource ??
      (item.attentionSource === "subject" ||
      item.attentionSource === "speaker" ||
      item.attentionSource === "cursor_target" ||
      item.attentionSource === "interface" ||
      item.attentionSource === "object" ||
      item.attentionSource === "text" ||
      item.attentionSource === "result"
        ? item.attentionSource
        : undefined);
    return [
      {
        id: `visual-${event.startTimeSeconds}-${index}`,
        startTimeSeconds: entry.startTimeSeconds,
        endTimeSeconds: entry.endTimeSeconds,
        rect,
        category,
        strength: clamp(Number(item.strength ?? event.score / 10)),
        confidence: clamp(
          Number(item.confidence ?? entry.confidence ?? 0.55)
        ),
        ...(typeof item.label === "string" && item.label.trim()
          ? { label: item.label.trim().slice(0, 100) }
          : {}),
        ...(attentionSource ? { attentionSource } : {}),
        ...(entry.cursorAction ? { cursorAction: entry.cursorAction } : {}),
        ...(entry.layoutHint ? { layoutHint: entry.layoutHint } : {}),
        evidence: [
          entry.evidence,
          ...(attentionSource
            ? [`multimodal_attention:${attentionSource}`]
            : []),
          ...(entry.cursorAction
            ? [`cursor_action:${entry.cursorAction}`]
            : []),
          ...(entry.layoutHint ? [`layout_hint:${entry.layoutHint}`] : []),
        ],
      },
    ];
  });
  if (parsed.length > 0) return parsed;

  const category: GameplayImportanceCategory =
    event.type === "interface_change" ? "hud" : event.type === "scene_change" ? "context" : "action";
  return [
    {
      id: `visual-${event.startTimeSeconds}`,
      startTimeSeconds: event.startTimeSeconds,
      endTimeSeconds: event.endTimeSeconds,
      rect:
        event.type === "interface_change"
          ? { x: 0, y: 0, width: 1, height: 0.24 }
          : { x: 0.18, y: 0.12, width: 0.64, height: 0.76 },
      category,
      strength: clamp(event.score / 10),
      confidence: event.type === "scene_change" ? 0.5 : 0.4,
      evidence: [`visual_event:${event.type}`],
    },
  ];
}

export function buildGameplayImportanceMap(input: {
  clipStartSeconds: number;
  clipEndSeconds: number;
  sourceWidth: number;
  sourceHeight: number;
  signals?: GameplaySignal[];
  visualEvents?: GameplayVisualEvent[];
  facecamRect?: NormalizedRect;
}): GameplayImportanceMap {
  const duration = Math.max(0.1, input.clipEndSeconds - input.clipStartSeconds);
  const sampleSpan = clamp(duration / Math.max(1, input.signals?.length ?? 0), 0.25, 1.2);
  const regions: GameplayImportanceRegion[] = [];
  const sceneChanges: number[] = [];

  for (const signal of input.signals ?? []) {
    if (
      !Number.isFinite(signal.timestampSeconds) ||
      signal.timestampSeconds < input.clipStartSeconds - 0.25 ||
      signal.timestampSeconds > input.clipEndSeconds + 0.25
    ) {
      continue;
    }
    if (signal.sceneChange) sceneChanges.push(signal.timestampSeconds);
    for (const sourceRegion of signal.regions ?? []) {
      const rect = normalizeRect(sourceRegion.rect);
      if (!rect) continue;
      const faceOverlap = input.facecamRect
        ? overlapFraction(rect, input.facecamRect)
        : 0;
      const strength = clamp(sourceRegion.strength * (faceOverlap > 0.45 ? 0.22 : 1));
      if (strength < 0.08) continue;
      regions.push({
        id: `signal-${signal.timestampSeconds}-${regions.length}`,
        startTimeSeconds: Math.max(input.clipStartSeconds, signal.timestampSeconds - sampleSpan / 2),
        endTimeSeconds: Math.min(input.clipEndSeconds, signal.timestampSeconds + sampleSpan / 2),
        rect,
        category: sourceRegion.category,
        strength,
        confidence: clamp(sourceRegion.confidence * (faceOverlap > 0.45 ? 0.45 : 1)),
        evidence: [
          `local_cv:${sourceRegion.category}`,
          ...(faceOverlap > 0.45 ? ["overlaps_webcam"] : []),
        ],
      });
    }
  }
  for (const event of input.visualEvents ?? []) {
    if (
      event.endTimeSeconds < input.clipStartSeconds ||
      event.startTimeSeconds > input.clipEndSeconds
    ) {
      continue;
    }
    if (event.type === "scene_change") sceneChanges.push(event.endTimeSeconds);
    regions.push(...regionsFromVisualEvent(event));
  }

  const merged = mergeImportanceRegions(regions, Math.max(0.6, sampleSpan * 1.4))
    .filter((region) => region.strength >= 0.1)
    .sort((a, b) => a.startTimeSeconds - b.startTimeSeconds)
    .slice(0, 240);
  const coveredSeconds = merged.reduce(
    (sum, region) => sum + Math.max(0, region.endTimeSeconds - region.startTimeSeconds),
    0
  );
  const temporalCoverage = clamp(coveredSeconds / Math.max(duration, 0.1));
  const evidenceConfidence = merged.length
    ? weightedMean(
        merged.map((region) => ({
          value: region.confidence,
          weight: Math.max(0.05, region.strength),
        }))
      )
    : 0;
  const confidence = clamp(evidenceConfidence * 0.65 + temporalCoverage * 0.35);
  const conservativeFallback = merged.length === 0 || confidence < 0.38;

  if (merged.length === 0) {
    merged.push({
      id: "importance-fallback",
      startTimeSeconds: input.clipStartSeconds,
      endTimeSeconds: input.clipEndSeconds,
      rect: { x: 0, y: 0, width: 1, height: 1 },
      category: "context",
      strength: 0.5,
      confidence: 0.25,
      evidence: ["conservative_full_context_fallback"],
    });
  }

  return {
    version: GAMEPLAY_LAYOUT_VERSION,
    clipStartSeconds: input.clipStartSeconds,
    clipEndSeconds: input.clipEndSeconds,
    sourceWidth: input.sourceWidth,
    sourceHeight: input.sourceHeight,
    regions: merged,
    sceneChanges: [...new Set(sceneChanges.map((value) => Math.round(value * 1000) / 1000))]
      .sort((a, b) => a - b),
    confidence,
    temporalCoverage,
    conservativeFallback,
  };
}

/** Semantic screen interaction is strong enough to use the Shorts layout planner. */
export function hasScreenInteractionEvidence(
  map: GameplayImportanceMap
): boolean {
  return map.regions.some(
    (region) =>
      region.confidence >= 0.52 &&
      region.strength >= 0.48 &&
      (region.attentionSource === "cursor_target" ||
        region.attentionSource === "interface" ||
        region.attentionSource === "text" ||
        region.layoutHint === "screen_focus" ||
        region.layoutHint === "screen_with_speaker")
  );
}

function viewportAt(centerX: number, cropWidth: number): NormalizedRect {
  const width = clamp(cropWidth, 0.12, 1);
  return {
    x: clamp(centerX - width / 2, 0, 1 - width),
    y: 0,
    width,
    height: 1,
  };
}

function gameplayCoverage(map: GameplayImportanceMap, cropWidth: number): number {
  if (cropWidth >= 0.98) return 1;
  const individual = weightedMean(
    map.regions.map((region) => {
      const center = rectCenter(region.rect);
      const viewport = viewportAt(center.x, cropWidth);
      return {
        value: overlapFraction(region.rect, viewport),
        weight: Math.max(0.02, region.strength * region.confidence),
      };
    })
  );
  const sampleTimes = [
    ...new Set(
      map.regions.flatMap((region) => [
        Math.round(region.startTimeSeconds * 2) / 2,
        Math.round(((region.startTimeSeconds + region.endTimeSeconds) / 2) * 2) /
          2,
      ])
    ),
  ];
  const simultaneous = weightedMean(
    sampleTimes.flatMap((time) => {
      const active = map.regions.filter(
        (region) =>
          region.startTimeSeconds <= time + 0.15 &&
          region.endTimeSeconds >= time - 0.15 &&
          region.strength * region.confidence >= 0.16
      );
      if (active.length === 0) return [];
      const left = Math.min(...active.map((region) => region.rect.x));
      const right = Math.max(
        ...active.map((region) => region.rect.x + region.rect.width)
      );
      const requiredWidth = Math.max(0.01, right - left);
      return [
        {
          value: clamp(cropWidth / requiredWidth),
          weight: Math.max(
            ...active.map((region) => region.strength * region.confidence)
          ),
        },
      ];
    })
  );
  return simultaneous > 0 ? Math.min(individual, simultaneous) : individual;
}

function pipRect(
  position: NonNullable<GameplayLayoutCandidate["pipPosition"]>,
  widthRatio: number
): NormalizedRect {
  const width = clamp(widthRatio, 0.2, 0.5);
  const height = clamp(width * 0.78, 0.16, 0.4);
  const margin = 0.045;
  const top = 0.07;
  const bottom = 0.16;
  return {
    x: position.endsWith("right") ? 1 - width - margin : margin,
    y: position.startsWith("bottom") ? 1 - height - bottom : top,
    width,
    height,
  };
}

function pipOcclusion(
  map: GameplayImportanceMap,
  position: NonNullable<GameplayLayoutCandidate["pipPosition"]>,
  widthRatio: number
): number {
  const overlay = pipRect(position, widthRatio);
  return weightedMean(
    map.regions.map((region) => ({
      value: overlapFraction(region.rect, overlay),
      weight: Math.max(0.02, region.strength * region.confidence),
    }))
  );
}

function faceQuality(candidate: FacecamCandidate | undefined): number {
  if (!candidate) return 0;
  const quality =
    candidate.quality === "good"
      ? 1
      : candidate.quality === "acceptable"
        ? 0.82
        : candidate.quality === "low_resolution"
          ? 0.48
          : 0.26;
  return clamp(quality * 0.65 + candidate.confidence * 0.35);
}

function reactionStrength(track: FaceTrack | undefined): number {
  if (!track?.points.length) return 0;
  const values = track.points.map((point) =>
    clamp(
      (point.speakingActivity ?? 0) * 0.5 +
        (point.mouthOpenRatio ?? 0) * 0.35 +
        (point.audioActivity ?? 0) * 0.15
    )
  );
  return values.sort((a, b) => b - a)[Math.floor(values.length * 0.12)] ?? 0;
}

function validateCandidate(input: {
  family: GameplayLayoutFamily;
  map: GameplayImportanceMap;
  cropWidth: number;
  facecam?: FacecamCandidate;
  pipPosition?: NonNullable<GameplayLayoutCandidate["pipPosition"]>;
  pipWidthRatio?: number;
  sourceWidth: number;
  sourceHeight: number;
}): GameplayLayoutValidation {
  let coverage = gameplayCoverage(input.map, input.cropWidth);
  if (input.pipPosition) {
    coverage *= 1 - pipOcclusion(input.map, input.pipPosition, input.pipWidthRatio ?? 0.3) * 0.8;
  }
  const faceVisibility =
    input.family === "gameplay_only" || input.family === "conservative"
      ? input.facecam
        ? 0.45
        : 1
      : faceQuality(input.facecam);
  const sourceQuality = input.facecam
    ? clamp(
        Math.min(1, input.facecam.sourceWidthPixels / 260) * 0.5 +
          Math.min(1, input.facecam.sourceHeightPixels / 180) * 0.5
      )
    : 1;
  const captionSafety = input.family === "pip" ? 0.86 : input.family === "stacked" ? 0.94 : 0.82;
  const temporalStability =
    input.family === "dynamic_reaction" ? 0.76 : input.family === "conservative" ? 1 : 0.92;
  const hardFailures: string[] = [];
  const warnings: string[] = [];
  if (input.map.confidence >= 0.5 && coverage < 0.66) {
    hardFailures.push("Important gameplay would fall outside the composition.");
  } else if (coverage < 0.8) {
    warnings.push("Some peripheral gameplay may be cropped.");
  }
  if (
    input.facecam &&
    input.family === "stacked" &&
    input.facecam.quality === "too_small"
  ) {
    hardFailures.push("The source webcam is too small for a large stacked panel.");
  }
  if (!input.facecam && ["stacked", "pip", "dynamic_reaction"].includes(input.family)) {
    hardFailures.push("This layout requires a reliable webcam region.");
  }
  if (sourceQuality < 0.5 && input.family !== "pip") {
    warnings.push("The webcam may soften when enlarged from the source.");
  }
  if (input.sourceWidth < 960 || input.sourceHeight < 540) {
    warnings.push("The source resolution limits aggressive reframing.");
  }
  return {
    valid: hardFailures.length === 0,
    hardFailures,
    warnings,
    gameplayCoverage: clamp(coverage),
    faceVisibility,
    captionSafety,
    sourceQuality,
    temporalStability,
  };
}

function candidateScore(
  validation: GameplayLayoutValidation,
  family: GameplayLayoutFamily,
  map: GameplayImportanceMap,
  reaction: number,
  hasFacecam: boolean
): number {
  if (!validation.valid) return 0;
  let score =
    validation.gameplayCoverage * 0.42 +
    validation.faceVisibility * 0.16 +
    validation.captionSafety * 0.12 +
    validation.sourceQuality * 0.12 +
    validation.temporalStability * 0.18;
  if (family === "dynamic_reaction") score += reaction >= 0.62 ? 0.08 : -0.08;
  if (family === "stacked" && reaction >= 0.48) score += 0.035;
  if (family === "pip" && hasFacecam) score += 0.025;
  if (family === "gameplay_only" && !hasFacecam) score += 0.08;
  if (family === "conservative" && map.conservativeFallback) score += 0.16;
  if (family !== "conservative" && map.conservativeFallback) score -= 0.16;
  return clamp(score);
}

function cropWidthForTarget(
  sourceWidth: number,
  sourceHeight: number,
  outputWidth: number,
  outputHeight: number,
  splitRatio = 0
): number {
  const gameplayHeight = outputHeight * (1 - splitRatio);
  const targetAspect = outputWidth / Math.max(1, gameplayHeight);
  return clamp(targetAspect * (sourceHeight / Math.max(1, sourceWidth)), 0.12, 1);
}

function captionSafeZoneForFamily(
  map: GameplayImportanceMap,
  family: GameplayLayoutFamily,
  pipPosition?: NonNullable<GameplayLayoutCandidate["pipPosition"]>,
  splitRatio = 0.34
): GameplayLayoutCandidate["captionSafeZone"] {
  const bandImportance = (band: NormalizedRect) =>
    weightedMean(
      map.regions.map((region) => ({
        value: overlapFraction(region.rect, band),
        weight: Math.max(0.02, region.strength * region.confidence),
      }))
    );
  let topPenalty = bandImportance({ x: 0.08, y: 0.08, width: 0.84, height: 0.26 });
  let bottomPenalty = bandImportance({
    x: 0.08,
    y: 0.62,
    width: 0.84,
    height: 0.23,
  });
  if (family === "stacked" || family === "dynamic_reaction") {
    topPenalty += Math.max(0.35, splitRatio);
  }
  if (family === "pip") {
    if (pipPosition?.startsWith("top")) topPenalty += 0.4;
    if (pipPosition?.startsWith("bottom")) bottomPenalty += 0.4;
  }
  const vertical = topPenalty + 0.04 < bottomPenalty ? "top" : "bottom";
  return {
    vertical,
    verticalOffsetPercent:
      family === "conservative"
        ? 16
        : vertical === "top"
          ? 12
          : Math.max(13, Math.round(splitRatio * 10)),
  };
}

export function generateGameplayLayoutCandidates(input: {
  map: GameplayImportanceMap;
  sourceWidth: number;
  sourceHeight: number;
  outputWidth?: number;
  outputHeight?: number;
  classification: FaceSourceClassification;
  facecam?: FacecamCandidate;
  primaryTrack?: FaceTrack;
}): GameplayLayoutCandidate[] {
  const outputWidth = input.outputWidth ?? 1080;
  const outputHeight = input.outputHeight ?? 1920;
  const reaction = reactionStrength(input.primaryTrack);
  const candidates: GameplayLayoutCandidate[] = [];
  const add = (candidate: Omit<GameplayLayoutCandidate, "score" | "validation">) => {
    const validation = validateCandidate({
      family: candidate.family,
      map: input.map,
      cropWidth: candidate.gameplayCropWidth,
      facecam: input.facecam,
      pipPosition: candidate.pipPosition,
      pipWidthRatio: candidate.pipWidthRatio,
      sourceWidth: input.sourceWidth,
      sourceHeight: input.sourceHeight,
    });
    candidates.push({
      ...candidate,
      validation,
      score: candidateScore(
        validation,
        candidate.family,
        input.map,
        reaction,
        Boolean(input.facecam)
      ),
    });
  };

  for (const splitRatio of [0.28, 0.34, 0.4]) {
    add({
      id: `stacked-${Math.round(splitRatio * 100)}`,
      family: "stacked",
      reason: "Uses a familiar Shorts stack: the creator stays visible while the primary screen content gets a wider tracked panel.",
      splitRatio,
      gameplayCropWidth: cropWidthForTarget(
        input.sourceWidth,
        input.sourceHeight,
        outputWidth,
        outputHeight,
        splitRatio
      ),
      captionSafeZone: captionSafeZoneForFamily(
        input.map,
        "stacked",
        undefined,
        splitRatio
      ),
    });
  }

  const pipWidthRatio = input.facecam?.quality === "low_resolution" ? 0.27 : 0.31;
  for (const pipPosition of [
    "top_left",
    "top_right",
    "bottom_left",
    "bottom_right",
  ] as const) {
    add({
      id: `pip-${pipPosition}`,
      family: "pip",
      reason: "Keeps the main content dominant and places the creator away from the important on-screen region.",
      pipPosition,
      pipWidthRatio,
      gameplayCropWidth: cropWidthForTarget(
        input.sourceWidth,
        input.sourceHeight,
        outputWidth,
        outputHeight
      ),
      captionSafeZone: captionSafeZoneForFamily(input.map, "pip", pipPosition),
    });
  }

  add({
    id: "dynamic-reaction",
    family: "dynamic_reaction",
    reason: "Preserves the main screen during action and increases creator emphasis only for a sustained reaction.",
    splitRatio: 0.34,
    pipPosition: "top_right",
    pipWidthRatio,
    gameplayCropWidth: cropWidthForTarget(
      input.sourceWidth,
      input.sourceHeight,
      outputWidth,
      outputHeight,
      0.34
    ),
    captionSafeZone: captionSafeZoneForFamily(input.map, "dynamic_reaction"),
  });

  add({
    id: "gameplay-only",
    family: "gameplay_only",
    reason: "Uses a clean full-height Shorts crop that follows the most important on-screen region.",
    gameplayCropWidth: cropWidthForTarget(
      input.sourceWidth,
      input.sourceHeight,
      outputWidth,
      outputHeight
    ),
    captionSafeZone: captionSafeZoneForFamily(input.map, "gameplay_only"),
  });

  add({
    id: "conservative-full-context",
    family: "conservative",
    reason: "Preserves the full source when evidence is uncertain or important regions are too far apart.",
    gameplayCropWidth: 1,
    captionSafeZone: captionSafeZoneForFamily(input.map, "conservative"),
  });

  return candidates.sort((a, b) => b.score - a.score);
}

function buildReactionIntervals(
  track: FaceTrack | undefined,
  startSeconds: number,
  endSeconds: number
): Array<{ start: number; end: number }> {
  if (!track) return [];
  const points = track.points
    .filter(
      (point) =>
        point.timestampSeconds >= startSeconds && point.timestampSeconds <= endSeconds
    )
    .map((point) => ({
      time: point.timestampSeconds,
      score: clamp(
        (point.speakingActivity ?? 0) * 0.5 +
          (point.mouthOpenRatio ?? 0) * 0.35 +
          (point.audioActivity ?? 0) * 0.15
      ),
    }))
    .filter((point) => point.score >= 0.58);
  const intervals: Array<{ start: number; end: number }> = [];
  for (const point of points) {
    const previous = intervals.at(-1);
    if (previous && point.time - previous.end <= 0.85) {
      previous.end = point.time + 0.45;
    } else {
      intervals.push({ start: point.time - 0.25, end: point.time + 0.45 });
    }
  }
  return intervals
    .map((interval) => ({
      start: clamp(interval.start, startSeconds, endSeconds),
      end: clamp(interval.end, startSeconds, endSeconds),
    }))
    .filter((interval) => interval.end - interval.start >= 0.7)
    .slice(0, 3);
}

export function buildGameplayCropKeyframes(
  map: GameplayImportanceMap,
  cropWidth: number
): SubjectCropKeyframe[] {
  const grouped = new Map<
    number,
    { regions: GameplayImportanceRegion[]; start: number; end: number }
  >();
  for (const region of map.regions.filter(
    (item) => item.strength * item.confidence >= 0.12
  )) {
    const midpoint = (region.startTimeSeconds + region.endTimeSeconds) / 2;
    const bucket = Math.round((midpoint - map.clipStartSeconds) / 0.75);
    const current = grouped.get(bucket);
    if (current) {
      current.regions.push(region);
      current.start = Math.min(current.start, region.startTimeSeconds);
      current.end = Math.max(current.end, region.endTimeSeconds);
    } else {
      grouped.set(bucket, {
        regions: [region],
        start: region.startTimeSeconds,
        end: region.endTimeSeconds,
      });
    }
  }
  const points = [...grouped.values()]
    .sort((a, b) => a.start - b.start)
    .map((group) => {
      // A Shorts frame should communicate one clear subject. Keep one primary
      // region plus at most one supporting region, instead of averaging every
      // HUD element and decorative motion into a vague center point.
      const composedRegions = [...group.regions]
        .sort((left, right) => {
          const weight = (region: GameplayImportanceRegion) =>
            region.strength *
            region.confidence *
            (region.attentionSource === "cursor_target"
              ? region.cursorAction === "clicking" ||
                region.cursorAction === "dragging"
                ? 1.22
                : 1.12
              : region.category === "outcome" ||
                  region.attentionSource === "result"
                ? 1.16
                : region.attentionSource === "speaker"
                  ? 1.08
                  : region.category === "context"
                    ? 0.72
                    : 1);
          return weight(right) - weight(left);
        })
        .slice(0, 2);
      const weightedCenters = composedRegions.map((region) => ({
        center: rectCenter(region.rect),
        weight: Math.max(
          0.02,
          region.strength *
            region.confidence *
            (region.attentionSource === "cursor_target" ? 1.16 : 1)
        ),
      }));
      const totalWeight = weightedCenters.reduce(
        (sum, item) => sum + item.weight,
        0
      );
      const left = Math.min(...composedRegions.map((region) => region.rect.x));
      const right = Math.max(
        ...composedRegions.map((region) => region.rect.x + region.rect.width)
      );
      const weightedX =
        weightedCenters.reduce(
          (sum, item) => sum + item.center.x * item.weight,
          0
        ) / Math.max(0.01, totalWeight);
      const weightedY =
        weightedCenters.reduce(
          (sum, item) => sum + item.center.y * item.weight,
          0
        ) / Math.max(0.01, totalWeight);
      return {
        time: Math.max(0, group.start - map.clipStartSeconds),
        center: {
          x: right - left <= cropWidth ? (left + right) / 2 : weightedX,
          y: weightedY,
        },
        confidence: clamp(
          weightedMean(
            composedRegions.map((region) => ({
              value: region.confidence,
              weight: Math.max(0.02, region.strength),
            }))
          )
        ),
        cursorDriven:
          composedRegions[0]?.attentionSource === "cursor_target" &&
          composedRegions[0]?.cursorAction !== "idle",
        cut: map.sceneChanges.some(
          (scene) => scene >= group.start - 0.1 && scene <= group.end + 0.1
        ),
      };
    });

  if (points.length === 0 || cropWidth >= 0.98) {
    return [
      {
        timestampSeconds: 0,
        centerX: 0.5,
        centerY: 0.5,
        cropWidth: Math.min(1, cropWidth),
        cropHeight: 1,
        interpolation: "hold",
        reason: "fallback",
        confidence: map.confidence,
      },
    ];
  }

  const keyframes: SubjectCropKeyframe[] = [];
  let previousCenter = points[0]!.center.x;
  let previousTime = points[0]!.time;
  let previousConfidence = points[0]!.confidence;
  for (const point of points) {
    const elapsed = Math.max(0.1, point.time - previousTime);
    const maxMove = point.cut ? 1 : Math.max(0.04, elapsed * 0.14);
    let centerX = point.center.x;
    const deadZone = point.cursorDriven ? 0.075 : 0.055;
    if (!point.cut && Math.abs(centerX - previousCenter) < deadZone) {
      centerX = previousCenter;
    } else if (!point.cut) {
      centerX = clamp(centerX, previousCenter - maxMove, previousCenter + maxMove);
    }
    // Do not chase a cursor between samples. A fast switch is allowed only
    // when the new visual evidence is materially stronger.
    if (
      !point.cut &&
      keyframes.length > 0 &&
      point.time - previousTime < 0.9 &&
      Math.abs(centerX - previousCenter) >= deadZone &&
      point.confidence < previousConfidence + 0.16
    ) {
      continue;
    }
    const interpolation: CropInterpolation = point.cut
      ? "cut"
      : keyframes.length === 0
        ? "hold"
        : "ease_in_out";
    const previous = keyframes.at(-1);
    if (
      previous &&
      !point.cut &&
      Math.abs(centerX - previous.centerX) < 0.035 &&
      point.time - previous.timestampSeconds < 2.2
    ) {
      continue;
    }
    keyframes.push({
      timestampSeconds: point.time,
      centerX: clamp(centerX, cropWidth / 2, 1 - cropWidth / 2),
      centerY: clamp(point.center.y, 0.3, 0.7),
      cropWidth,
      cropHeight: 1,
      interpolation,
      reason: point.cut ? "scene_change" : keyframes.length ? "subject_motion" : "initial_composition",
      confidence: point.confidence,
    });
    previousCenter = centerX;
    previousTime = point.time;
    previousConfidence = point.confidence;
    if (keyframes.length >= 40) break;
  }
  if (keyframes[0] && keyframes[0].timestampSeconds > 0) {
    keyframes.unshift({
      ...keyframes[0],
      timestampSeconds: 0,
      interpolation: "hold",
      reason: "initial_composition",
    });
  }
  return keyframes;
}

export function planGameplayLayout(input: {
  map: GameplayImportanceMap;
  classification: FaceSourceClassification;
  facecam?: FacecamCandidate;
  tracks: FaceTrack[];
  primaryTrackId?: string;
  sourceWidth: number;
  sourceHeight: number;
  outputWidth?: number;
  outputHeight?: number;
}): GameplayLayoutPlan {
  const primaryTrack = input.tracks.find((track) => track.id === input.primaryTrackId);
  const candidates = generateGameplayLayoutCandidates({ ...input, primaryTrack });
  const selected =
    candidates.find((candidate) => candidate.validation.valid && candidate.score > 0) ??
    candidates.find((candidate) => candidate.family === "conservative")!;
  const reactionIntervals =
    selected.family === "dynamic_reaction"
      ? buildReactionIntervals(
          primaryTrack,
          input.map.clipStartSeconds,
          input.map.clipEndSeconds
        )
      : [];
  const segments: GameplayLayoutSegment[] = [];
  if (reactionIntervals.length === 0) {
    segments.push({
      id: "layout-1",
      startTimeSeconds: input.map.clipStartSeconds,
      endTimeSeconds: input.map.clipEndSeconds,
      family: selected.family === "dynamic_reaction" ? "pip" : selected.family,
      transitionIn: "start",
      reason: selected.reason,
    });
  } else {
    let cursor = input.map.clipStartSeconds;
    for (const interval of reactionIntervals) {
      if (interval.start - cursor >= 0.5) {
        segments.push({
          id: `layout-${segments.length + 1}`,
          startTimeSeconds: cursor,
          endTimeSeconds: interval.start,
          family: "pip",
          transitionIn: segments.length ? "ease" : "start",
          reason: "Gameplay remains primary during setup and action.",
        });
      }
      segments.push({
        id: `layout-${segments.length + 1}`,
        startTimeSeconds: interval.start,
        endTimeSeconds: interval.end,
        family: "stacked",
        transitionIn: segments.length ? "ease" : "start",
        reason: "A sustained creator reaction merits temporary emphasis.",
      });
      cursor = interval.end;
    }
    if (input.map.clipEndSeconds - cursor >= 0.5) {
      segments.push({
        id: `layout-${segments.length + 1}`,
        startTimeSeconds: cursor,
        endTimeSeconds: input.map.clipEndSeconds,
        family: "pip",
        transitionIn: "ease",
        reason: "Return to gameplay after the reaction.",
      });
    }
  }
  const warnings = [...selected.validation.warnings];
  if (input.map.conservativeFallback) {
    warnings.push("Gameplay evidence was uncertain, so the planner preferred wider context.");
  }
  return {
    version: GAMEPLAY_LAYOUT_VERSION,
    selectedFamily: selected.family,
    selectedCandidateId: selected.id,
    reason: selected.reason,
    candidates,
    segments,
    gameplayCropKeyframes: buildGameplayCropKeyframes(
      input.map,
      selected.gameplayCropWidth
    ),
    captionSafeZone: selected.captionSafeZone,
    confidence: clamp(input.map.confidence * 0.55 + selected.score * 0.45),
    warnings: [...new Set(warnings)],
  };
}

export function verticalLayoutForGameplayFamily(
  family: GameplayLayoutFamily
): VerticalLayout {
  if (family === "stacked" || family === "dynamic_reaction") {
    return "facecam_top_gameplay_bottom";
  }
  if (family === "pip") return "facecam_pip";
  if (family === "gameplay_only") return "subject_aware_crop";
  return "center_crop";
}

/**
 * Resolve Auto without discarding a stronger face-tracking recommendation.
 * A conservative gameplay plan only means gameplay evidence is uncertain;
 * it must not replace a valid moving-subject or active-speaker camera plan.
 */
export function verticalLayoutForAutomaticPlan(
  family: GameplayLayoutFamily | null | undefined,
  faceRecommendation: VerticalLayout | null | undefined,
  hasReliableFaceTracking = false
): VerticalLayout {
  const planned =
    !family || family === "conservative"
      ? faceRecommendation ?? "center_crop"
      : verticalLayoutForGameplayFamily(family);
  // The preview applies its validated camera keyframes even when an older or
  // conservative analysis labeled the base composition Center Crop. Export
  // must use the same tracked camera instead of silently becoming static.
  return planned === "center_crop" && hasReliableFaceTracking
    ? "subject_aware_crop"
    : planned;
}
