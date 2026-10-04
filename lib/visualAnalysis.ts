export const VISUAL_ANALYSIS_VERSION = "visual-context-v2";

export type LocalVisualEventType =
  | "scene_change"
  | "high_motion"
  | "interface_change";

export type VisualNarrativeRole =
  | "setup"
  | "action"
  | "outcome"
  | "reaction"
  | "context";

export type VisualAttentionSource =
  | "subject"
  | "speaker"
  | "cursor_target"
  | "interface"
  | "object"
  | "text"
  | "result";

export type VisualLayoutHint =
  | "single_focus"
  | "speaker_focus"
  | "screen_focus"
  | "screen_with_speaker"
  | "wide_context";

export type CursorAction =
  | "pointing"
  | "clicking"
  | "dragging"
  | "moving"
  | "idle";

export interface GrayFrame {
  timestampSeconds: number;
  width: number;
  height: number;
  pixels: Uint8Array;
}

export interface FrameChangeMetrics {
  timestampSeconds: number;
  difference: number;
  hashDistance: number;
  topBandDifference: number;
  middleBandDifference: number;
  bottomBandDifference: number;
}

export interface LocalVisualEvent {
  startTimeSeconds: number;
  endTimeSeconds: number;
  type: LocalVisualEventType;
  score: number;
  summary: string;
  rawData: {
    analysisVersion: typeof VISUAL_ANALYSIS_VERSION;
    samplingIntervalSeconds: number;
    difference: number;
    hashDistance: number;
    topBandDifference: number;
    middleBandDifference: number;
    bottomBandDifference: number;
    sampleCount: number;
  };
}

export interface VisualEvidenceReference {
  kind: "frame" | "video" | "local_signal";
  timestampSeconds?: number;
  startTimeSeconds?: number;
  endTimeSeconds?: number;
  storagePath?: string;
  description?: string;
}

export interface StructuredVisualEvent {
  timeSeconds: number;
  type: VisualNarrativeRole;
  description: string;
  confidence: number;
  evidenceTimestampSeconds?: number;
  layoutHint?: VisualLayoutHint;
  cursor?: {
    point: { x: number; y: number };
    targetRect?: { x: number; y: number; width: number; height: number };
    action: CursorAction;
    confidence: number;
  };
  importanceRegions?: Array<{
    rect: { x: number; y: number; width: number; height: number };
    category: "action" | "visual_focus" | "hud" | "outcome" | "context";
    strength: number;
    label?: string;
    attentionSource?: VisualAttentionSource;
  }>;
}

export interface VisualEvidenceRequest {
  kind: "frames" | "video" | "high_resolution_frame" | "earlier_context" | "later_context";
  startTimeSeconds: number;
  endTimeSeconds: number;
  fps?: number;
  reason: string;
}

export interface StructuredVisualContext {
  version: typeof VISUAL_ANALYSIS_VERSION;
  sourceId: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  eventType: string;
  summary: string;
  events: StructuredVisualEvent[];
  confidence: number;
  uncertainties: string[];
  sufficient: boolean;
  analysisLevel: "local" | "screenshots" | "video";
  modelVersion: string;
  evidence: VisualEvidenceReference[];
  requestedEvidence?: VisualEvidenceRequest;
}

export interface VisualChangeThresholds {
  motionDifference: number;
  sceneDifference: number;
  sceneHashDistance: number;
  interfaceBandDifference: number;
}

export const DEFAULT_VISUAL_CHANGE_THRESHOLDS: VisualChangeThresholds = {
  motionDifference: 0.075,
  sceneDifference: 0.235,
  sceneHashDistance: 0.34,
  interfaceBandDifference: 0.12,
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Parse the binary P5 PGM files produced by the lightweight FFmpeg scan. */
export function parsePortableGraymap(
  input: Uint8Array,
  timestampSeconds: number
): GrayFrame {
  let offset = 0;
  const isWhitespace = (value: number) =>
    value === 9 || value === 10 || value === 13 || value === 32;
  const readToken = (): string => {
    while (offset < input.length) {
      if (input[offset] === 35) {
        while (offset < input.length && input[offset] !== 10) offset += 1;
      } else if (isWhitespace(input[offset]!)) {
        offset += 1;
      } else {
        break;
      }
    }
    const start = offset;
    while (
      offset < input.length &&
      !isWhitespace(input[offset]!) &&
      input[offset] !== 35
    ) {
      offset += 1;
    }
    return new TextDecoder("ascii").decode(input.subarray(start, offset));
  };

  const magic = readToken();
  const width = Number.parseInt(readToken(), 10);
  const height = Number.parseInt(readToken(), 10);
  const maxValue = Number.parseInt(readToken(), 10);
  if (
    magic !== "P5" ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    maxValue !== 255
  ) {
    throw new Error("Unsupported grayscale analysis frame");
  }

  // The binary raster begins after the single header separator. Preserve any
  // following byte because a valid first pixel can itself look like whitespace.
  if (input[offset] === 13 && input[offset + 1] === 10) offset += 2;
  else if (isWhitespace(input[offset]!)) offset += 1;
  const expected = width * height;
  if (input.length - offset < expected) {
    throw new Error("Incomplete grayscale analysis frame");
  }
  return {
    timestampSeconds,
    width,
    height,
    pixels: input.slice(offset, offset + expected),
  };
}

function meanAbsoluteDifference(
  previous: GrayFrame,
  current: GrayFrame,
  fromRow = 0,
  throughRow = current.height
): number {
  if (previous.width !== current.width || previous.height !== current.height) {
    return 1;
  }
  const start = Math.max(0, Math.floor(fromRow)) * current.width;
  const end = Math.min(current.height, Math.ceil(throughRow)) * current.width;
  let difference = 0;
  let samples = 0;
  // Every second pixel is enough at the scan's deliberately low resolution.
  for (let index = start; index < end; index += 2) {
    difference += Math.abs(current.pixels[index]! - previous.pixels[index]!);
    samples += 1;
  }
  return samples > 0 ? difference / (samples * 255) : 0;
}

/** 64-bit difference hash represented as booleans to avoid BigInt JSON issues. */
function differenceHash(frame: GrayFrame): boolean[] {
  const hash: boolean[] = [];
  for (let row = 0; row < 8; row += 1) {
    const y = Math.min(
      frame.height - 1,
      Math.floor(((row + 0.5) / 8) * frame.height)
    );
    for (let column = 0; column < 8; column += 1) {
      const leftX = Math.min(
        frame.width - 1,
        Math.floor(((column + 0.25) / 9) * frame.width)
      );
      const rightX = Math.min(
        frame.width - 1,
        Math.floor(((column + 1.25) / 9) * frame.width)
      );
      hash.push(
        frame.pixels[y * frame.width + leftX]! <
          frame.pixels[y * frame.width + rightX]!
      );
    }
  }
  return hash;
}

function normalizedHashDistance(a: boolean[], b: boolean[]): number {
  const length = Math.min(a.length, b.length);
  if (length === 0) return 0;
  let changed = 0;
  for (let index = 0; index < length; index += 1) {
    if (a[index] !== b[index]) changed += 1;
  }
  return changed / length;
}

export function measureFrameChange(
  previous: GrayFrame,
  current: GrayFrame
): FrameChangeMetrics {
  const band = current.height * 0.22;
  return {
    timestampSeconds: current.timestampSeconds,
    difference: meanAbsoluteDifference(previous, current),
    hashDistance: normalizedHashDistance(
      differenceHash(previous),
      differenceHash(current)
    ),
    topBandDifference: meanAbsoluteDifference(previous, current, 0, band),
    middleBandDifference: meanAbsoluteDifference(
      previous,
      current,
      band,
      current.height - band
    ),
    bottomBandDifference: meanAbsoluteDifference(
      previous,
      current,
      current.height - band,
      current.height
    ),
  };
}

function eventFromMetric(
  metric: FrameChangeMetrics,
  intervalSeconds: number,
  thresholds: VisualChangeThresholds
): LocalVisualEvent | null {
  const scene =
    metric.difference >= thresholds.sceneDifference ||
    (metric.difference >= thresholds.motionDifference * 1.5 &&
      metric.hashDistance >= thresholds.sceneHashDistance);
  const strongestBand = Math.max(
    metric.topBandDifference,
    metric.bottomBandDifference
  );
  const interfaceChange =
    !scene &&
    strongestBand >= thresholds.interfaceBandDifference &&
    strongestBand >= metric.middleBandDifference * 1.3;
  const motion = metric.difference >= thresholds.motionDifference;
  if (!scene && !interfaceChange && !motion) return null;

  const type: LocalVisualEventType = scene
    ? "scene_change"
    : interfaceChange
      ? "interface_change"
      : "high_motion";
  const intensity = scene
    ? Math.max(
        metric.difference / thresholds.sceneDifference,
        metric.hashDistance / thresholds.sceneHashDistance
      )
    : interfaceChange
      ? strongestBand / thresholds.interfaceBandDifference
      : metric.difference / thresholds.motionDifference;
  const score = Math.round(Math.min(10, 3.5 + intensity * 3.2) * 10) / 10;
  const summary =
    type === "scene_change"
      ? "A significant visual scene change was detected."
      : type === "interface_change"
        ? "A prominent on-screen interface or text region changed."
        : "A burst of visual motion was detected independently of speech.";
  return {
    startTimeSeconds: Math.max(0, metric.timestampSeconds - intervalSeconds),
    endTimeSeconds: metric.timestampSeconds,
    type,
    score,
    summary,
    rawData: {
      analysisVersion: VISUAL_ANALYSIS_VERSION,
      samplingIntervalSeconds: intervalSeconds,
      difference: metric.difference,
      hashDistance: metric.hashDistance,
      topBandDifference: metric.topBandDifference,
      middleBandDifference: metric.middleBandDifference,
      bottomBandDifference: metric.bottomBandDifference,
      sampleCount: 1,
    },
  };
}

function mergeAdjacentVisualEvents(
  events: LocalVisualEvent[],
  intervalSeconds: number
): LocalVisualEvent[] {
  const merged: LocalVisualEvent[] = [];
  for (const event of events) {
    const previous = merged.at(-1);
    if (
      previous &&
      previous.type === event.type &&
      event.startTimeSeconds - previous.endTimeSeconds <= intervalSeconds * 1.1
    ) {
      const oldSamples = previous.rawData.sampleCount;
      const newSamples = oldSamples + event.rawData.sampleCount;
      const blend = (left: number, right: number) =>
        (left * oldSamples + right * event.rawData.sampleCount) / newSamples;
      previous.endTimeSeconds = event.endTimeSeconds;
      previous.score = Math.max(previous.score, event.score);
      previous.rawData = {
        ...previous.rawData,
        difference: blend(
          previous.rawData.difference,
          event.rawData.difference
        ),
        hashDistance: blend(
          previous.rawData.hashDistance,
          event.rawData.hashDistance
        ),
        topBandDifference: blend(
          previous.rawData.topBandDifference,
          event.rawData.topBandDifference
        ),
        middleBandDifference: blend(
          previous.rawData.middleBandDifference,
          event.rawData.middleBandDifference
        ),
        bottomBandDifference: blend(
          previous.rawData.bottomBandDifference,
          event.rawData.bottomBandDifference
        ),
        sampleCount: newSamples,
      };
      continue;
    }
    merged.push({ ...event, rawData: { ...event.rawData } });
  }
  return merged;
}

export function detectVisualChanges(
  frames: GrayFrame[],
  intervalSeconds: number,
  thresholds: VisualChangeThresholds = DEFAULT_VISUAL_CHANGE_THRESHOLDS
): { events: LocalVisualEvent[]; metrics: FrameChangeMetrics[] } {
  const ordered = [...frames].sort(
    (a, b) => a.timestampSeconds - b.timestampSeconds
  );
  const metrics: FrameChangeMetrics[] = [];
  const events: LocalVisualEvent[] = [];
  for (let index = 1; index < ordered.length; index += 1) {
    const metric = measureFrameChange(ordered[index - 1]!, ordered[index]!);
    metrics.push(metric);
    const event = eventFromMetric(metric, intervalSeconds, thresholds);
    if (event) events.push(event);
  }
  return {
    events: mergeAdjacentVisualEvents(events, intervalSeconds),
    metrics,
  };
}

export function selectVisualEvidenceTimestamps(input: {
  startTimeSeconds: number;
  endTimeSeconds: number;
  focusTimeSeconds: number;
  events: Array<{
    startTimeSeconds: number;
    endTimeSeconds: number;
    score: number;
  }>;
  maximumFrames: number;
}): number[] {
  const start = Math.max(0, input.startTimeSeconds);
  const end = Math.max(start, input.endTimeSeconds);
  const maximumFrames = Math.max(1, Math.floor(input.maximumFrames));
  const clamp = (value: number) => Math.max(start, Math.min(end, value));
  const minimumGap = Math.max(0.35, (end - start) / 40);
  const selected: number[] = [];
  const add = (value: number) => {
    const bounded = clamp(value);
    if (selected.some((existing) => Math.abs(existing - bounded) < minimumGap)) {
      return;
    }
    if (selected.length < maximumFrames) selected.push(bounded);
  };

  // Always establish the beginning, payoff neighborhood, and ending. Event
  // midpoints then reserve part of the budget for salient moments.
  add(start);
  if (maximumFrames > 1) add(end);
  if (maximumFrames > 2) add(input.focusTimeSeconds);
  const eventBudget = Math.max(0, Math.floor(maximumFrames * 0.42));
  let eventFrames = 0;
  for (const event of [...input.events].sort((a, b) => b.score - a.score)) {
    const before = selected.length;
    add((event.startTimeSeconds + event.endTimeSeconds) / 2);
    if (selected.length > before) eventFrames += 1;
    if (eventFrames >= eventBudget || selected.length >= maximumFrames) break;
  }

  // Fill the remaining budget across the full clip. For a short clip this is
  // approximately one frame per second; longer clips widen the cadence rather
  // than silently ignoring the back half of the moment.
  const duration = end - start;
  const cadence = Math.max(1, duration / Math.max(1, maximumFrames - 1));
  for (
    let timestamp = start + cadence;
    timestamp < end - minimumGap && selected.length < maximumFrames;
    timestamp += cadence
  ) {
    add(timestamp);
  }

  // Use spare slots for event boundaries, which helps distinguish setup from
  // action without decoding every video frame.
  for (const event of [...input.events].sort((a, b) => b.score - a.score)) {
    add(event.startTimeSeconds);
    add(event.endTimeSeconds);
    if (selected.length >= maximumFrames) break;
  }
  return selected.sort((a, b) => a - b);
}

export function formatVisualContextForRanking(
  context: StructuredVisualContext
): string {
  const events = context.events
    .map(
      (event) =>
        `${event.type}@${event.timeSeconds.toFixed(2)}s: ${event.description}`
    )
    .join(" | ");
  const uncertainty = context.uncertainties.length
    ? ` Uncertain: ${context.uncertainties.join("; ")}.`
    : "";
  return `VISUAL CONTEXT (${context.analysisLevel}, confidence ${context.confidence.toFixed(2)}): ${context.summary}${events ? ` | ${events}` : ""}.${uncertainty}`;
}

export function sanitizeStructuredVisualContext(
  context: StructuredVisualContext
): StructuredVisualContext {
  const start = Math.max(0, context.startTimeSeconds);
  const end = Math.max(start, context.endTimeSeconds);
  return {
    ...context,
    startTimeSeconds: start,
    endTimeSeconds: end,
    confidence: clamp01(context.confidence),
    summary: context.summary.trim().slice(0, 600),
    uncertainties: context.uncertainties
      .map((item) => item.trim().slice(0, 240))
      .filter(Boolean)
      .slice(0, 8),
    events: context.events
      .filter(
        (event) =>
          Number.isFinite(event.timeSeconds) &&
          event.timeSeconds >= start - 15 &&
          event.timeSeconds <= end + 15
      )
      .map((event) => ({
        ...event,
        timeSeconds: Math.max(start - 15, Math.min(end + 15, event.timeSeconds)),
        confidence: clamp01(event.confidence),
        description: event.description.trim().slice(0, 320),
        cursor: event.cursor
          ? {
              point: {
                x: clamp01(event.cursor.point.x),
                y: clamp01(event.cursor.point.y),
              },
              ...(event.cursor.targetRect
                ? {
                    targetRect: {
                      x: clamp01(event.cursor.targetRect.x),
                      y: clamp01(event.cursor.targetRect.y),
                      width: clamp01(event.cursor.targetRect.width),
                      height: clamp01(event.cursor.targetRect.height),
                    },
                  }
                : {}),
              action: event.cursor.action,
              confidence: clamp01(event.cursor.confidence),
            }
          : undefined,
        importanceRegions: event.importanceRegions
          ?.map((region) => ({
            ...region,
            rect: {
              x: clamp01(region.rect.x),
              y: clamp01(region.rect.y),
              width: clamp01(region.rect.width),
              height: clamp01(region.rect.height),
            },
            strength: clamp01(region.strength),
            label: region.label?.trim().slice(0, 100),
          }))
          .filter(
            (region) =>
              region.rect.width >= 0.02 &&
              region.rect.height >= 0.02 &&
              region.rect.x + region.rect.width <= 1.02 &&
              region.rect.y + region.rect.height <= 1.02
          )
          .slice(0, 4),
      }))
      .slice(0, 48),
  };
}
