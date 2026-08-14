import type { CropInterpolation } from "@/lib/professionalReframe";

export type PreviewCropKeyframe = {
  timestampSeconds: number;
  centerX: number;
  centerY?: number;
  cropWidth?: number;
  cropHeight?: number;
  interpolation?: CropInterpolation;
};

export type PreviewCameraFrame = {
  centerX: number;
  centerY: number;
  cropWidth?: number;
  cropHeight?: number;
};

function interpolate(a: number, b: number, progress: number): number {
  return a + (b - a) * progress;
}

function interpolationProgress(
  interpolation: CropInterpolation | undefined,
  progress: number
): number {
  if (interpolation === "cut" || interpolation === "hold") return 0;
  if (interpolation === "ease_in_out") {
    return progress * progress * (3 - 2 * progress);
  }
  return progress;
}

export function previewCameraFrameAt(
  keyframes: PreviewCropKeyframe[],
  relativeTime: number
): PreviewCameraFrame | null {
  if (keyframes.length === 0) return null;
  const sorted = [...keyframes].sort(
    (a, b) => a.timestampSeconds - b.timestampSeconds
  );
  const first = sorted[0]!;
  if (relativeTime <= first.timestampSeconds) {
    return {
      centerX: first.centerX,
      centerY: first.centerY ?? 0.5,
      cropWidth: first.cropWidth,
      cropHeight: first.cropHeight,
    };
  }
  for (let index = 1; index < sorted.length; index++) {
    const next = sorted[index]!;
    if (relativeTime >= next.timestampSeconds) continue;
    const previous = sorted[index - 1]!;
    const span = Math.max(
      0.001,
      next.timestampSeconds - previous.timestampSeconds
    );
    const linear = Math.min(
      1,
      Math.max(0, (relativeTime - previous.timestampSeconds) / span)
    );
    const progress = interpolationProgress(next.interpolation, linear);
    return {
      centerX: interpolate(previous.centerX, next.centerX, progress),
      centerY: interpolate(
        previous.centerY ?? 0.5,
        next.centerY ?? 0.5,
        progress
      ),
      cropWidth:
        previous.cropWidth != null && next.cropWidth != null
          ? interpolate(previous.cropWidth, next.cropWidth, progress)
          : previous.cropWidth ?? next.cropWidth,
      cropHeight:
        previous.cropHeight != null && next.cropHeight != null
          ? interpolate(previous.cropHeight, next.cropHeight, progress)
          : previous.cropHeight ?? next.cropHeight,
    };
  }
  const last = sorted[sorted.length - 1]!;
  return {
    centerX: last.centerX,
    centerY: last.centerY ?? 0.5,
    cropWidth: last.cropWidth,
    cropHeight: last.cropHeight,
  };
}

