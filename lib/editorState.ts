export type MarkerKind =
  | "manual"
  | "hype"
  | "laughter"
  | "topic"
  | "chat"
  | "audio";

export interface EditorSegment {
  id: string;
  sourceStart: number;
  sourceEnd: number;
  label: string;
  volume: number;
  muted: boolean;
  fadeInSeconds: number;
  fadeOutSeconds: number;
}

export interface TimelineMarker {
  id: string;
  timeSeconds: number;
  endTimeSeconds?: number;
  label: string;
  kind: MarkerKind;
  score?: number;
  source: "manual" | "ai";
}

export type OverlayType = "text" | "lower-third" | "image" | "broll";
export type OverlayPosition =
  | "center"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

export interface EditorOverlay {
  id: string;
  type: OverlayType;
  segmentId: string;
  startOffsetSeconds: number;
  endOffsetSeconds: number;
  label: string;
  text?: string;
  assetPath?: string;
  position: OverlayPosition;
  scalePercent: number;
}

export interface EditorSettings {
  snapping: boolean;
  normalizeAudio: boolean;
  denoiseAudio: boolean;
  verticalBackground: "crop" | "blur";
}

export interface EditorState {
  version: 1;
  segments: EditorSegment[];
  markers: TimelineMarker[];
  overlays: EditorOverlay[];
  settings: EditorSettings;
}

export const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
  snapping: true,
  normalizeAudio: false,
  denoiseAudio: false,
  verticalBackground: "crop",
};

export function emptyEditorState(): EditorState {
  return {
    version: 1,
    segments: [],
    markers: [],
    overlays: [],
    settings: { ...DEFAULT_EDITOR_SETTINGS },
  };
}

function finite(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function text(value: unknown, fallback: string, max = 160): string {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, max)
    : fallback;
}

export function createEditorSegment(
  sourceStart: number,
  sourceEnd: number,
  label?: string
): EditorSegment {
  const start = Math.max(0, finite(sourceStart));
  const end = Math.max(start + 0.05, finite(sourceEnd, start + 0.05));
  return {
    id: crypto.randomUUID(),
    sourceStart: start,
    sourceEnd: end,
    label: label?.trim().slice(0, 80) || "Cut",
    volume: 1,
    muted: false,
    fadeInSeconds: 0,
    fadeOutSeconds: 0,
  };
}

export function segmentDuration(segment: EditorSegment): number {
  return Math.max(0, segment.sourceEnd - segment.sourceStart);
}

export function sequenceDuration(segments: EditorSegment[]): number {
  return segments.reduce((total, segment) => total + segmentDuration(segment), 0);
}

export function sequenceBounds(segments: EditorSegment[]): {
  start: number;
  end: number;
} | null {
  if (segments.length === 0) return null;
  return {
    start: Math.min(...segments.map((segment) => segment.sourceStart)),
    end: Math.max(...segments.map((segment) => segment.sourceEnd)),
  };
}

export function normalizeEditorState(value: unknown): EditorState {
  if (!value || typeof value !== "object") return emptyEditorState();
  const raw = value as Record<string, unknown>;

  const segments = Array.isArray(raw.segments)
    ? raw.segments.slice(0, 200).flatMap((entry, index) => {
        if (!entry || typeof entry !== "object") return [];
        const item = entry as Record<string, unknown>;
        const start = Math.max(0, finite(item.sourceStart));
        const end = Math.max(start, finite(item.sourceEnd));
        if (end - start < 0.05) return [];
        const duration = end - start;
        return [
          {
            id: text(item.id, `segment-${index}`, 100),
            sourceStart: start,
            sourceEnd: end,
            label: text(item.label, `Cut ${index + 1}`, 80),
            volume: Math.min(2, Math.max(0, finite(item.volume, 1))),
            muted: item.muted === true,
            fadeInSeconds: Math.min(
              duration / 2,
              Math.max(0, finite(item.fadeInSeconds))
            ),
            fadeOutSeconds: Math.min(
              duration / 2,
              Math.max(0, finite(item.fadeOutSeconds))
            ),
          } satisfies EditorSegment,
        ];
      })
    : [];

  const segmentIds = new Set(segments.map((segment) => segment.id));
  const markers = Array.isArray(raw.markers)
    ? raw.markers.slice(0, 500).flatMap((entry, index) => {
        if (!entry || typeof entry !== "object") return [];
        const item = entry as Record<string, unknown>;
        const timeSeconds = Math.max(0, finite(item.timeSeconds));
        const end = finite(item.endTimeSeconds, timeSeconds);
        const kindValues: MarkerKind[] = [
          "manual",
          "hype",
          "laughter",
          "topic",
          "chat",
          "audio",
        ];
        const kind = kindValues.includes(item.kind as MarkerKind)
          ? (item.kind as MarkerKind)
          : "manual";
        return [
          {
            id: text(item.id, `marker-${index}`, 100),
            timeSeconds,
            ...(end > timeSeconds ? { endTimeSeconds: end } : {}),
            label: text(item.label, "Marker", 120),
            kind,
            ...(typeof item.score === "number"
              ? { score: Math.max(0, item.score) }
              : {}),
            source: item.source === "ai" ? "ai" : "manual",
          } satisfies TimelineMarker,
        ];
      })
    : [];

  const overlays = Array.isArray(raw.overlays)
    ? raw.overlays.slice(0, 100).flatMap((entry, index) => {
        if (!entry || typeof entry !== "object") return [];
        const item = entry as Record<string, unknown>;
        const segmentId = text(item.segmentId, "", 100);
        if (!segmentIds.has(segmentId)) return [];
        const overlayTypes: OverlayType[] = ["text", "lower-third", "image", "broll"];
        const positions: OverlayPosition[] = [
          "center",
          "top-left",
          "top-right",
          "bottom-left",
          "bottom-right",
        ];
        const type = overlayTypes.includes(item.type as OverlayType)
          ? (item.type as OverlayType)
          : "text";
        const position = positions.includes(item.position as OverlayPosition)
          ? (item.position as OverlayPosition)
          : type === "lower-third"
            ? "bottom-left"
            : "center";
        return [
          {
            id: text(item.id, `overlay-${index}`, 100),
            type,
            segmentId,
            startOffsetSeconds: Math.max(0, finite(item.startOffsetSeconds)),
            endOffsetSeconds: Math.max(0.05, finite(item.endOffsetSeconds, 3)),
            label: text(item.label, type === "broll" ? "B-roll" : "Overlay", 80),
            ...(typeof item.text === "string" ? { text: item.text.slice(0, 300) } : {}),
            ...(typeof item.assetPath === "string"
              ? { assetPath: item.assetPath.slice(0, 500) }
              : {}),
            position,
            scalePercent: Math.min(100, Math.max(10, finite(item.scalePercent, 30))),
          } satisfies EditorOverlay,
        ];
      })
    : [];

  const settingsRaw =
    raw.settings && typeof raw.settings === "object"
      ? (raw.settings as Record<string, unknown>)
      : {};

  return {
    version: 1,
    segments,
    markers,
    overlays,
    settings: {
      snapping: settingsRaw.snapping !== false,
      normalizeAudio: settingsRaw.normalizeAudio === true,
      denoiseAudio: settingsRaw.denoiseAudio === true,
      verticalBackground:
        settingsRaw.verticalBackground === "blur" ? "blur" : "crop",
    },
  };
}

export function removeRangesFromSegments(
  segments: EditorSegment[],
  ranges: Array<{ start: number; end: number }>
): EditorSegment[] {
  let next = segments.map((segment) => ({ ...segment }));
  for (const range of ranges) {
    const start = Math.max(0, range.start);
    const end = Math.max(start, range.end);
    next = next.flatMap((segment) => {
      if (end <= segment.sourceStart || start >= segment.sourceEnd) return [segment];
      const pieces: EditorSegment[] = [];
      if (start - segment.sourceStart >= 0.15) {
        pieces.push({
          ...segment,
          id: crypto.randomUUID(),
          sourceEnd: Math.min(start, segment.sourceEnd),
        });
      }
      if (segment.sourceEnd - end >= 0.15) {
        pieces.push({
          ...segment,
          id: crypto.randomUUID(),
          sourceStart: Math.max(end, segment.sourceStart),
        });
      }
      return pieces;
    });
  }
  return next;
}

export function outputTimeForSegment(
  segments: EditorSegment[],
  segmentId: string,
  sourceOffset = 0
): number {
  let output = 0;
  for (const segment of segments) {
    if (segment.id === segmentId) {
      return output + Math.min(segmentDuration(segment), Math.max(0, sourceOffset));
    }
    output += segmentDuration(segment);
  }
  return output;
}
