import { describe, expect, it } from "vitest";
import type { Detection } from "@mediapipe/tasks-vision";
import {
  selectBrowserTrackedFace,
  smoothBrowserFaceRect,
} from "@/lib/browserFaceTracking";

function detection(
  originX: number,
  originY: number,
  width: number,
  height: number,
  score = 0.9
): Detection {
  return {
    boundingBox: { originX, originY, width, height, angle: 0 },
    categories: [
      { score, index: 0, categoryName: "face", displayName: "Face" },
    ],
    keypoints: [],
  };
}

describe("browser face tracking", () => {
  it("normalizes a detected face box", () => {
    const selected = selectBrowserTrackedFace(
      [detection(640, 180, 320, 360)],
      1920,
      1080,
      null
    );
    expect(selected).toEqual({
      x: 640 / 1920,
      y: 180 / 1080,
      width: 320 / 1920,
      height: 360 / 1080,
    });
  });

  it("keeps the current person when another face appears", () => {
    const previous = { x: 0.1, y: 0.2, width: 0.14, height: 0.3 };
    const selected = selectBrowserTrackedFace(
      [
        detection(205, 220, 270, 330, 0.82),
        detection(1250, 150, 430, 500, 0.98),
      ],
      1920,
      1080,
      previous
    );
    expect(selected?.x).toBeCloseTo(205 / 1920);
  });

  it("smooths crop movement instead of snapping", () => {
    const previous = { x: 0.1, y: 0.2, width: 0.2, height: 0.3 };
    const next = { x: 0.5, y: 0.4, width: 0.3, height: 0.4 };
    const smoothed = smoothBrowserFaceRect(previous, next, 0.5);
    const previousCenterX = previous.x + previous.width / 2;
    const nextCenterX = next.x + next.width / 2;
    const smoothedCenterX = smoothed.x + smoothed.width / 2;
    expect(smoothedCenterX).toBeGreaterThan(previousCenterX);
    expect(smoothedCenterX).toBeLessThan(nextCenterX);
    expect(smoothedCenterX - previousCenterX).toBeLessThanOrEqual(0.0551);
    expect(smoothed.width - previous.width).toBeLessThanOrEqual(0.0251);
  });

  it("filters tiny detector jitter", () => {
    const previous = { x: 0.2, y: 0.2, width: 0.2, height: 0.3 };
    const next = { x: 0.203, y: 0.201, width: 0.2, height: 0.3 };
    const smoothed = smoothBrowserFaceRect(previous, next);
    expect(smoothed.x).toBeCloseTo(previous.x);
    expect(smoothed.y).toBeCloseTo(previous.y);
  });
});
