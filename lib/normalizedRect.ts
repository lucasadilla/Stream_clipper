/**
 * Normalized rectangle math for face / facecam regions.
 *
 * Every detected region is stored as fractions of the source frame (0..1) so
 * results survive source files with different resolutions. Convert to pixels
 * only when building FFmpeg commands (see normalizedRectToPixels).
 */

export type NormalizedRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PixelRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const EPSILON = 1e-6;
/** Small floating-point overshoots (e.g. x+width = 1.0000001) are clamped, not rejected. */
const FLOAT_TOLERANCE = 0.02;

export function isValidNormalizedRect(rect: NormalizedRect): boolean {
  return (
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.x >= 0 &&
    rect.y >= 0 &&
    rect.width > 0 &&
    rect.height > 0 &&
    rect.x + rect.width <= 1 + EPSILON &&
    rect.y + rect.height <= 1 + EPSILON
  );
}

/**
 * Clamp a rect into the 0..1 frame. Returns null when the input is not a
 * usable rectangle even after clamping small floating-point errors.
 */
export function normalizeRect(rect: {
  x: number;
  y: number;
  width: number;
  height: number;
}): NormalizedRect | null {
  if (
    !Number.isFinite(rect.x) ||
    !Number.isFinite(rect.y) ||
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height)
  ) {
    return null;
  }

  let { x, y, width, height } = rect;

  // Reject rects that are wildly outside the frame rather than silently
  // clamping garbage coordinates into something that looks plausible.
  if (
    x < -FLOAT_TOLERANCE ||
    y < -FLOAT_TOLERANCE ||
    width <= 0 ||
    height <= 0 ||
    x > 1 + FLOAT_TOLERANCE ||
    y > 1 + FLOAT_TOLERANCE ||
    width > 1 + FLOAT_TOLERANCE ||
    height > 1 + FLOAT_TOLERANCE
  ) {
    return null;
  }

  x = Math.min(1, Math.max(0, x));
  y = Math.min(1, Math.max(0, y));
  width = Math.min(1, width);
  height = Math.min(1, height);
  if (x + width > 1) x = Math.max(0, 1 - width);
  if (y + height > 1) y = Math.max(0, 1 - height);

  const result = { x, y, width, height };
  return isValidNormalizedRect(result) ? result : null;
}

export function rectArea(rect: NormalizedRect): number {
  return rect.width * rect.height;
}

export function rectCenter(rect: NormalizedRect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

export function rectCenterDistance(a: NormalizedRect, b: NormalizedRect): number {
  const ca = rectCenter(a);
  const cb = rectCenter(b);
  return Math.hypot(ca.x - cb.x, ca.y - cb.y);
}

export function rectIoU(a: NormalizedRect, b: NormalizedRect): number {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= left || bottom <= top) return 0;
  const intersection = (right - left) * (bottom - top);
  const union = rectArea(a) + rectArea(b) - intersection;
  return union > 0 ? intersection / union : 0;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

/**
 * Median rect across a set of detections. Medians (rather than means) keep a
 * couple of false detections from dragging the facecam crop around.
 */
export function medianRect(rects: NormalizedRect[]): NormalizedRect | null {
  if (rects.length === 0) return null;
  return normalizeRect({
    x: median(rects.map((r) => r.x)),
    y: median(rects.map((r) => r.y)),
    width: median(rects.map((r) => r.width)),
    height: median(rects.map((r) => r.height)),
  });
}

export const FACECAM_EXPANSION = {
  /** Face box -> crop box width multiplier (head + some context). */
  widthMultiplier: 2.4,
  /** Face box -> crop box height multiplier (hair + shoulders). */
  heightMultiplier: 2.8,
  /** Shift the expanded box downward by this fraction of the face height so shoulders are included. */
  downwardShiftRatio: 0.35,
} as const;

/**
 * Expand a raw face detection into a usable facecam crop: include the head,
 * hair, shoulders and a little surrounding context, clamped to the frame.
 */
export function expandFaceToFacecamCrop(
  face: NormalizedRect,
  expansion: {
    widthMultiplier?: number;
    heightMultiplier?: number;
    downwardShiftRatio?: number;
  } = {}
): NormalizedRect {
  const widthMultiplier =
    expansion.widthMultiplier ?? FACECAM_EXPANSION.widthMultiplier;
  const heightMultiplier =
    expansion.heightMultiplier ?? FACECAM_EXPANSION.heightMultiplier;
  const downwardShiftRatio =
    expansion.downwardShiftRatio ?? FACECAM_EXPANSION.downwardShiftRatio;

  const center = rectCenter(face);
  const width = Math.min(1, face.width * widthMultiplier);
  const height = Math.min(1, face.height * heightMultiplier);
  const centerY = center.y + face.height * downwardShiftRatio;

  const clamped = normalizeRect({
    x: center.x - width / 2,
    y: centerY - height / 2,
    width,
    height,
  });
  return clamped ?? face;
}

function toEven(value: number): number {
  const rounded = Math.round(value);
  return rounded % 2 === 0 ? rounded : rounded - 1;
}

/**
 * Convert a normalized rect to integer pixel coordinates for a specific
 * source. Width/height are forced to even numbers (required by yuv420p
 * encoders) and the crop always stays inside the frame.
 */
export function normalizedRectToPixels(
  rect: NormalizedRect,
  sourceWidth: number,
  sourceHeight: number
): PixelRect {
  if (
    !Number.isFinite(sourceWidth) ||
    !Number.isFinite(sourceHeight) ||
    sourceWidth < 2 ||
    sourceHeight < 2
  ) {
    throw new Error(`Invalid source dimensions ${sourceWidth}x${sourceHeight}`);
  }
  const safe = normalizeRect(rect);
  if (!safe) {
    throw new Error("Invalid normalized rect for pixel conversion");
  }

  let width = Math.max(2, toEven(safe.width * sourceWidth));
  let height = Math.max(2, toEven(safe.height * sourceHeight));
  width = Math.min(width, toEven(sourceWidth));
  height = Math.min(height, toEven(sourceHeight));

  let x = Math.round(safe.x * sourceWidth);
  let y = Math.round(safe.y * sourceHeight);
  x = Math.max(0, Math.min(x, Math.floor(sourceWidth) - width));
  y = Math.max(0, Math.min(y, Math.floor(sourceHeight) - height));

  return { x, y, width, height };
}
