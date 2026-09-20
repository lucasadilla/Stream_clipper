import { describe, expect, it } from "vitest";
import { coverCropAroundFocus } from "@/lib/videoFrameCrop";

describe("coverCropAroundFocus", () => {
  it("produces a cover crop with the requested physical aspect", () => {
    const crop = coverCropAroundFocus({
      region: null,
      focus: null,
      sourceAspect: 16 / 9,
      targetAspect: 9 / (16 * 0.34),
    });

    expect((crop.width * (16 / 9)) / crop.height).toBeCloseTo(
      9 / (16 * 0.34),
      5
    );
    expect(crop.x).toBeGreaterThanOrEqual(0);
    expect(crop.x + crop.width).toBeLessThanOrEqual(1);
  });

  it("keeps an edge face inside its webcam region", () => {
    const region = { x: 0.72, y: 0.66, width: 0.26, height: 0.31 };
    const focus = { x: 0.88, y: 0.72, width: 0.07, height: 0.1 };
    const crop = coverCropAroundFocus({
      region,
      focus,
      sourceAspect: 16 / 9,
      targetAspect: 9 / (16 * 0.34),
    });
    const faceCenterX = focus.x + focus.width / 2;
    const faceCenterY = focus.y + focus.height / 2;

    expect(crop.x).toBeGreaterThanOrEqual(region.x);
    expect(crop.y).toBeGreaterThanOrEqual(region.y);
    expect(crop.x + crop.width).toBeLessThanOrEqual(region.x + region.width);
    expect(crop.y + crop.height).toBeLessThanOrEqual(region.y + region.height);
    expect(faceCenterX).toBeGreaterThanOrEqual(crop.x);
    expect(faceCenterX).toBeLessThanOrEqual(crop.x + crop.width);
    expect(faceCenterY).toBeGreaterThanOrEqual(crop.y);
    expect(faceCenterY).toBeLessThanOrEqual(crop.y + crop.height);
  });

  it("falls back to the full frame for invalid analysis geometry", () => {
    const crop = coverCropAroundFocus({
      region: { x: 5, y: 5, width: 0, height: 0 },
      sourceAspect: 16 / 9,
      targetAspect: 16 / 9,
    });

    expect(crop).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });
});
