import { normalizeRect, type NormalizedRect } from "@/lib/normalizedRect";

const FULL_FRAME: NormalizedRect = { x: 0, y: 0, width: 1, height: 1 };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Fits a source region to a destination aspect ratio while keeping the face
 * inside the crop. Coordinates stay normalized so previews and render inputs
 * can share the same geometry.
 */
export function coverCropAroundFocus(options: {
  region?: NormalizedRect | null;
  focus?: NormalizedRect | null;
  sourceAspect: number;
  targetAspect: number;
}): NormalizedRect {
  const region = options.region
    ? normalizeRect(options.region) ?? FULL_FRAME
    : FULL_FRAME;
  const focus = options.focus ? normalizeRect(options.focus) : null;
  const sourceAspect =
    Number.isFinite(options.sourceAspect) && options.sourceAspect > 0
      ? options.sourceAspect
      : 16 / 9;
  const targetAspect =
    Number.isFinite(options.targetAspect) && options.targetAspect > 0
      ? options.targetAspect
      : 1;

  const focusX = focus
    ? clamp(focus.x + focus.width / 2, region.x, region.x + region.width)
    : region.x + region.width / 2;
  const focusY = focus
    ? clamp(focus.y + focus.height / 2, region.y, region.y + region.height)
    : region.y + region.height / 2;

  let width = region.width;
  let height = region.height;
  if ((width * sourceAspect) / height > targetAspect) {
    width = (height * targetAspect) / sourceAspect;
  } else {
    height = (width * sourceAspect) / targetAspect;
  }

  return {
    x: clamp(focusX - width / 2, region.x, region.x + region.width - width),
    y: clamp(focusY - height / 2, region.y, region.y + region.height - height),
    width,
    height,
  };
}
