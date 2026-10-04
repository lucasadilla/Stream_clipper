import type {
  GameplayImportanceMap,
  GameplayImportanceRegion,
} from "@/lib/gameplayLayout";
import { rectCenter } from "@/lib/normalizedRect";
import {
  validateAndRepairCameraPlan,
  type CropKeyframe,
} from "@/lib/professionalReframe";
import { previewCameraFrameAt } from "@/lib/reframePlayback";

export const CONTEXT_AWARE_FRAMING_VERSION = "context-aware-framing-v2";

export interface FramingTranscriptChunk {
  startTimeSeconds: number;
  endTimeSeconds: number;
  text: string;
}

export interface ContextAwareVisualTarget {
  id: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  centerX: number;
  centerY: number;
  rect: GameplayImportanceRegion["rect"];
  category: GameplayImportanceRegion["category"];
  attentionSource?: GameplayImportanceRegion["attentionSource"];
  cursorAction?: GameplayImportanceRegion["cursorAction"];
  layoutHint?: GameplayImportanceRegion["layoutHint"];
  label?: string;
  confidence: number;
  transcriptCue?: string;
  evidence: string[];
}

export interface ContextAwareFramingPlan {
  version: typeof CONTEXT_AWARE_FRAMING_VERSION;
  clipStartSeconds: number;
  clipEndSeconds: number;
  cropKeyframes: CropKeyframe[];
  visualTargets: ContextAwareVisualTarget[];
  sampledFrameTimestamps: number[];
  sampleCadenceSeconds: number | null;
  activeSpeakerDecisionCount: number;
  compositionTemplate:
    | "single_focus"
    | "speaker_focus"
    | "screen_focus"
    | "screen_with_speaker"
    | "wide_context";
  maxPrimaryRegions: 2;
  confidence: number;
  mode: "speaker_and_visual_context" | "active_speaker" | "visual_context" | "fallback";
  warnings: string[];
}

const REFERENCE_LANGUAGE =
  /\b(?:look|watch|see|show|showing|shown|this|that|these|those|here|there|screen|score|map|menu|button|item|thing|right there|on screen|behind me|in front)\b/i;

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? null;
}

function transcriptCueForRegion(
  region: GameplayImportanceRegion,
  transcript: FramingTranscriptChunk[]
): string | undefined {
  const nearby = transcript
    .filter(
      (chunk) =>
        chunk.endTimeSeconds >= region.startTimeSeconds - 1.5 &&
        chunk.startTimeSeconds <= region.endTimeSeconds + 1.5
    )
    .map((chunk) => chunk.text.trim())
    .filter(Boolean);
  return nearby.find((text) => REFERENCE_LANGUAGE.test(text))?.slice(0, 180);
}

function targetPriority(
  region: GameplayImportanceRegion,
  transcriptCue: string | undefined
): number {
  const categoryWeight =
    region.category === "outcome"
      ? 1
      : region.category === "visual_focus"
        ? 0.98
        : region.category === "action"
          ? 0.9
          : region.category === "hud"
            ? 0.82
            : 0.72;
  const attentionWeight =
    region.attentionSource === "cursor_target"
      ? region.cursorAction === "clicking" || region.cursorAction === "dragging"
        ? 1.16
        : region.cursorAction === "moving"
          ? 0.92
          : 1.06
      : region.attentionSource === "result"
        ? 1.12
        : region.attentionSource === "interface" ||
            region.attentionSource === "text"
          ? 1.04
          : 1;
  return clamp(
    region.strength * region.confidence * categoryWeight * attentionWeight +
      (transcriptCue ? 0.18 : 0)
  );
}

function isGroundedSemanticRegion(region: GameplayImportanceRegion): boolean {
  if (
    region.attentionSource === "cursor_target" &&
    region.cursorAction === "idle"
  ) {
    return false;
  }
  return region.evidence.some(
    (entry) =>
      entry.startsWith("multimodal_context:") ||
      entry.startsWith("multimodal_attention:")
  );
}

function targetLabel(region: GameplayImportanceRegion): string | undefined {
  if (region.label) return region.label;
  const evidence = region.evidence.find((entry) =>
    entry.startsWith("multimodal_context:")
  );
  return evidence?.split(":").slice(1).join(":").replace(/_/g, " ");
}

function selectVisualTargets(input: {
  clipStartSeconds: number;
  clipEndSeconds: number;
  importanceMap?: GameplayImportanceMap;
  transcript: FramingTranscriptChunk[];
}): ContextAwareVisualTarget[] {
  const candidates = (input.importanceMap?.regions ?? [])
    .filter(isGroundedSemanticRegion)
    .flatMap((region) => {
      // A wide-context instruction means separated areas must remain visible;
      // zooming to just one of them would remove information.
      if (region.layoutHint === "wide_context") return [];
      const cue = transcriptCueForRegion(region, input.transcript);
      const priority = targetPriority(region, cue);
      const minimum =
        region.attentionSource === "cursor_target"
          ? region.cursorAction === "moving"
            ? 0.64
            : 0.5
          : region.category === "outcome" || region.category === "visual_focus"
          ? 0.42
          : cue
            ? 0.46
            : 0.56;
      if (priority < minimum) return [];
      const center = rectCenter(region.rect);
      const start = Math.max(input.clipStartSeconds, region.startTimeSeconds - 0.35);
      const naturalEnd = Math.min(input.clipEndSeconds, region.endTimeSeconds + 0.45);
      const end = Math.min(
        input.clipEndSeconds,
        Math.max(
          naturalEnd,
          start +
            (region.attentionSource === "cursor_target"
              ? 1.35
              : cue
                ? 1.45
                : 1.1)
        )
      );
      if (end - start < 0.4) return [];
      return [
        {
          id: region.id,
          startTimeSeconds: start,
          endTimeSeconds: end,
          centerX: center.x,
          centerY: center.y,
          rect: { ...region.rect },
          category: region.category,
          attentionSource: region.attentionSource,
          cursorAction: region.cursorAction,
          layoutHint: region.layoutHint,
          label: targetLabel(region),
          confidence: priority,
          transcriptCue: cue,
          evidence: [...region.evidence],
        } satisfies ContextAwareVisualTarget,
      ];
    })
    .sort(
      (left, right) =>
        left.startTimeSeconds - right.startTimeSeconds ||
        right.confidence - left.confidence
    );

  const selected: ContextAwareVisualTarget[] = [];
  for (const candidate of candidates) {
    const previous = selected.at(-1);
    if (!previous) {
      selected.push(candidate);
      continue;
    }
    const overlaps = candidate.startTimeSeconds <= previous.endTimeSeconds + 0.35;
    const close =
      Math.abs(candidate.centerX - previous.centerX) <=
        (candidate.attentionSource === "cursor_target" ? 0.14 : 0.1) &&
      Math.abs(candidate.centerY - previous.centerY) <=
        (candidate.attentionSource === "cursor_target" ? 0.18 : 0.14);
    if (overlaps && close) {
      const stronger =
        candidate.confidence > previous.confidence ? candidate : previous;
      selected[selected.length - 1] = {
        ...stronger,
        startTimeSeconds: Math.min(
          previous.startTimeSeconds,
          candidate.startTimeSeconds
        ),
        endTimeSeconds: Math.max(previous.endTimeSeconds, candidate.endTimeSeconds),
        evidence: [...new Set([...previous.evidence, ...candidate.evidence])],
        transcriptCue: previous.transcriptCue ?? candidate.transcriptCue,
      };
      continue;
    }
    if (overlaps) {
      if (candidate.confidence > previous.confidence + 0.12) {
        previous.endTimeSeconds = Math.max(
          previous.startTimeSeconds + 1.05,
          candidate.startTimeSeconds - 0.15
        );
        selected.push({
          ...candidate,
          startTimeSeconds: Math.max(
            candidate.startTimeSeconds,
            previous.startTimeSeconds + 1.05
          ),
        });
      }
      continue;
    }
    selected.push(candidate);
    if (selected.length >= 12) break;
  }
  return selected;
}

function compositionTemplate(
  targets: ContextAwareVisualTarget[],
  activeSpeakerDecisionCount: number,
  importanceMap?: GameplayImportanceMap
): ContextAwareFramingPlan["compositionTemplate"] {
  if (
    importanceMap?.regions.some(
      (region) => region.layoutHint === "wide_context"
    )
  ) {
    return "wide_context";
  }
  if (
    targets.some(
      (target) => target.layoutHint === "screen_with_speaker"
    )
  ) {
    return "screen_with_speaker";
  }
  if (
    targets.some(
      (target) =>
        target.layoutHint === "screen_focus" ||
        target.attentionSource === "cursor_target" ||
        target.attentionSource === "interface" ||
        target.attentionSource === "text"
    )
  ) {
    return "screen_focus";
  }
  if (activeSpeakerDecisionCount > 0) return "speaker_focus";
  return "single_focus";
}

function sceneChangeNear(
  sceneChanges: number[],
  absoluteTimestampSeconds: number
): boolean {
  return sceneChanges.some(
    (timestamp) => Math.abs(timestamp - absoluteTimestampSeconds) <= 0.18
  );
}

function normalizedSamples(
  values: number[],
  startTimeSeconds: number,
  endTimeSeconds: number
): number[] {
  return [...new Set(values)]
    .filter(
      (value) =>
        Number.isFinite(value) &&
        value >= startTimeSeconds - 0.1 &&
        value <= endTimeSeconds + 0.1
    )
    .map((value) => Math.round(value * 1000) / 1000)
    .sort((a, b) => a - b);
}

/**
 * Fuse the stable active-speaker camera with grounded visual-model targets.
 * Visual focus is temporary: the camera looks ahead, holds long enough to be
 * understandable, then returns to the speaker trajectory. Uncertain regions
 * never override the face plan.
 */
export function buildContextAwareFramingPlan(input: {
  clipStartSeconds: number;
  clipEndSeconds: number;
  baseKeyframes: CropKeyframe[];
  importanceMap?: GameplayImportanceMap;
  transcript?: FramingTranscriptChunk[];
  sampledFrameTimestamps?: number[];
  sceneChanges?: number[];
  activeSpeakerDecisionCount?: number;
}): ContextAwareFramingPlan {
  const duration = Math.max(0.1, input.clipEndSeconds - input.clipStartSeconds);
  const transcript = input.transcript ?? [];
  const targets = selectVisualTargets({
    clipStartSeconds: input.clipStartSeconds,
    clipEndSeconds: input.clipEndSeconds,
    importanceMap: input.importanceMap,
    transcript,
  });
  const fallbackCropWidth = clamp((9 / 16) * (9 / 16), 0.12, 0.95);
  const base = input.baseKeyframes.length
    ? [...input.baseKeyframes]
    : [
        {
          timestampSeconds: 0,
          centerX: 0.5,
          centerY: 0.5,
          cropWidth: fallbackCropWidth,
          cropHeight: 1,
          interpolation: "hold" as const,
          reason: "fallback" as const,
          confidence: 0.25,
        },
      ];

  const additions: CropKeyframe[] = [];
  const covered = (relativeTime: number) =>
    targets.some(
      (target) =>
        relativeTime >= target.startTimeSeconds - input.clipStartSeconds &&
        relativeTime <= target.endTimeSeconds - input.clipStartSeconds
    );

  for (const target of targets) {
    const eventStart = target.startTimeSeconds - input.clipStartSeconds;
    const eventEnd = target.endTimeSeconds - input.clipStartSeconds;
    const cut = sceneChangeNear(
      input.sceneChanges ?? input.importanceMap?.sceneChanges ?? [],
      target.startTimeSeconds
    );
    const focusLead =
      target.attentionSource === "cursor_target" ? 0.35 : 0.6;
    const focusTime = cut ? eventStart : Math.max(0, eventStart - focusLead);
    const baseAtFocus = previewCameraFrameAt(base, focusTime) ?? {
      centerX: 0.5,
      centerY: 0.5,
      cropWidth: fallbackCropWidth,
      cropHeight: 1,
    };
    const cropWidth = clamp(baseAtFocus.cropWidth ?? fallbackCropWidth, 0.1, 1);
    const cropHeight = clamp(baseAtFocus.cropHeight ?? 1, 0.1, 1);
    additions.push({
      timestampSeconds: focusTime,
      centerX: clamp(target.centerX, cropWidth / 2, 1 - cropWidth / 2),
      centerY: clamp(target.centerY, cropHeight / 2, 1 - cropHeight / 2),
      cropWidth,
      cropHeight,
      interpolation: cut ? "cut" : "ease_in_out",
      reason: "visual_focus",
      confidence: target.confidence,
    });

    const returnTime = Math.min(duration, eventEnd + 0.35);
    if (returnTime < duration - 0.05) {
      const returnFrame = previewCameraFrameAt(base, returnTime);
      if (returnFrame) {
        additions.push({
          timestampSeconds: returnTime,
          centerX: returnFrame.centerX,
          centerY: returnFrame.centerY,
          cropWidth: returnFrame.cropWidth ?? cropWidth,
          cropHeight: returnFrame.cropHeight ?? cropHeight,
          interpolation: "ease_in_out",
          reason: "speaker_change",
          confidence: Math.max(0.45, target.confidence * 0.86),
        });
      }
    }
  }

  const combined = [
    ...base.filter((frame) => !covered(frame.timestampSeconds)),
    ...additions,
  ].sort(
    (left, right) =>
      left.timestampSeconds - right.timestampSeconds ||
      (left.reason === "visual_focus" ? 1 : -1)
  );
  const deduplicated: CropKeyframe[] = [];
  for (const frame of combined) {
    const previous = deduplicated.at(-1);
    if (
      previous &&
      Math.abs(previous.timestampSeconds - frame.timestampSeconds) < 0.04
    ) {
      if (
        frame.reason === "visual_focus" ||
        (frame.confidence ?? 0) > (previous.confidence ?? 0)
      ) {
        deduplicated[deduplicated.length - 1] = frame;
      }
      continue;
    }
    deduplicated.push(frame);
  }
  const repaired = validateAndRepairCameraPlan(deduplicated);
  const sampledFrameTimestamps = normalizedSamples(
    input.sampledFrameTimestamps ?? [],
    input.clipStartSeconds,
    input.clipEndSeconds
  );
  const cadence = median(
    sampledFrameTimestamps
      .slice(1)
      .map((value, index) => value - sampledFrameTimestamps[index]!)
      .filter((value) => value > 0.05)
  );
  const activeSpeakerDecisionCount = Math.max(
    0,
    Math.round(input.activeSpeakerDecisionCount ?? 0)
  );
  const baseConfidence = median(
    base
      .map((frame) => frame.confidence)
      .filter((value): value is number => Number.isFinite(value))
  );
  const visualConfidence = median(targets.map((target) => target.confidence));
  const confidence = clamp(
    targets.length && base.length
      ? (baseConfidence ?? 0.55) * 0.55 + (visualConfidence ?? 0.5) * 0.45
      : targets.length
        ? visualConfidence ?? 0.5
        : baseConfidence ?? 0.35
  );
  const mode =
    targets.length > 0 && activeSpeakerDecisionCount > 0
      ? "speaker_and_visual_context"
      : targets.length > 0
        ? "visual_context"
        : activeSpeakerDecisionCount > 0
          ? "active_speaker"
          : "fallback";

  return {
    version: CONTEXT_AWARE_FRAMING_VERSION,
    clipStartSeconds: input.clipStartSeconds,
    clipEndSeconds: input.clipEndSeconds,
    cropKeyframes: repaired.keyframes,
    visualTargets: targets,
    sampledFrameTimestamps,
    sampleCadenceSeconds: cadence,
    activeSpeakerDecisionCount,
    compositionTemplate: compositionTemplate(
      targets,
      activeSpeakerDecisionCount,
      input.importanceMap
    ),
    maxPrimaryRegions: 2,
    confidence,
    mode,
    warnings: repaired.validation.warnings,
  };
}

/** Rebase a stored clip plan when the creator trims the selected range. */
export function contextAwareCropKeyframesForRange(input: {
  plan: ContextAwareFramingPlan | undefined;
  startTimeSeconds: number;
  endTimeSeconds: number;
}): CropKeyframe[] {
  const plan = input.plan;
  if (!plan?.cropKeyframes.length) return [];
  const start = Math.max(plan.clipStartSeconds, input.startTimeSeconds);
  const end = Math.min(plan.clipEndSeconds, Math.max(start + 0.05, input.endTimeSeconds));
  const offset = start - plan.clipStartSeconds;
  const duration = end - start;
  const opening = previewCameraFrameAt(plan.cropKeyframes, offset);
  const rebased: CropKeyframe[] = opening
    ? [
        {
          timestampSeconds: 0,
          centerX: opening.centerX,
          centerY: opening.centerY,
          cropWidth: opening.cropWidth ?? 1,
          cropHeight: opening.cropHeight ?? 1,
          interpolation: "hold",
          reason: "initial_composition",
          confidence: plan.confidence,
        },
      ]
    : [];
  for (const frame of plan.cropKeyframes) {
    if (frame.timestampSeconds <= offset + 0.04) continue;
    if (frame.timestampSeconds > offset + duration + 0.04) break;
    rebased.push({
      ...frame,
      timestampSeconds: Math.max(0, frame.timestampSeconds - offset),
    });
  }
  return rebased;
}
