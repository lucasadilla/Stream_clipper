import { describe, expect, it } from "vitest";
import {
  expandFaceToFacecamCrop,
  isValidNormalizedRect,
  median,
  medianRect,
  normalizeRect,
  normalizedRectToPixels,
  rectCenter,
  rectCenterDistance,
  rectIoU,
} from "@/lib/normalizedRect";

describe("normalizeRect", () => {
  it("accepts a valid rect unchanged", () => {
    const rect = { x: 0.1, y: 0.2, width: 0.3, height: 0.4 };
    expect(normalizeRect(rect)).toEqual(rect);
  });

  it("clamps small floating point overshoots", () => {
    const rect = normalizeRect({ x: 0.8, y: 0.8, width: 0.200001, height: 0.2000001 });
    expect(rect).not.toBeNull();
    expect(rect!.x + rect!.width).toBeLessThanOrEqual(1);
    expect(rect!.y + rect!.height).toBeLessThanOrEqual(1);
  });

  it("clamps tiny negative origins", () => {
    const rect = normalizeRect({ x: -0.005, y: -0.01, width: 0.2, height: 0.2 });
    expect(rect).toEqual({ x: 0, y: 0, width: 0.2, height: 0.2 });
  });

  it("rejects zero or negative sizes", () => {
    expect(normalizeRect({ x: 0.1, y: 0.1, width: 0, height: 0.2 })).toBeNull();
    expect(normalizeRect({ x: 0.1, y: 0.1, width: 0.2, height: -0.2 })).toBeNull();
  });

  it("rejects garbage far outside the frame", () => {
    expect(normalizeRect({ x: 5, y: 0.1, width: 0.2, height: 0.2 })).toBeNull();
    expect(normalizeRect({ x: NaN, y: 0.1, width: 0.2, height: 0.2 })).toBeNull();
  });
});

describe("isValidNormalizedRect", () => {
  it("validates bounds", () => {
    expect(isValidNormalizedRect({ x: 0, y: 0, width: 1, height: 1 })).toBe(true);
    expect(isValidNormalizedRect({ x: 0.9, y: 0, width: 0.2, height: 0.5 })).toBe(false);
  });
});

describe("normalizedRectToPixels", () => {
  it("converts to integer pixel coordinates", () => {
    const px = normalizedRectToPixels(
      { x: 0.78, y: 0.66, width: 0.18, height: 0.25 },
      1920,
      1080
    );
    expect(Number.isInteger(px.x)).toBe(true);
    expect(Number.isInteger(px.width)).toBe(true);
    expect(px.width).toBeGreaterThan(0);
    expect(px.x + px.width).toBeLessThanOrEqual(1920);
    expect(px.y + px.height).toBeLessThanOrEqual(1080);
  });

  it("forces even dimensions", () => {
    const px = normalizedRectToPixels(
      { x: 0.1, y: 0.1, width: 0.333, height: 0.333 },
      1921,
      1081
    );
    expect(px.width % 2).toBe(0);
    expect(px.height % 2).toBe(0);
  });

  it("keeps the crop inside the frame when the rect touches an edge", () => {
    const px = normalizedRectToPixels(
      { x: 0.75, y: 0.75, width: 0.25, height: 0.25 },
      1280,
      720
    );
    expect(px.x + px.width).toBeLessThanOrEqual(1280);
    expect(px.y + px.height).toBeLessThanOrEqual(720);
  });

  it("throws for invalid sources", () => {
    expect(() =>
      normalizedRectToPixels({ x: 0, y: 0, width: 0.5, height: 0.5 }, 0, 1080)
    ).toThrow();
  });
});

describe("expandFaceToFacecamCrop", () => {
  it("expands the face box and stays in frame", () => {
    const face = { x: 0.8, y: 0.7, width: 0.08, height: 0.12 };
    const crop = expandFaceToFacecamCrop(face);
    expect(crop.width).toBeGreaterThan(face.width);
    expect(crop.height).toBeGreaterThan(face.height);
    expect(crop.x + crop.width).toBeLessThanOrEqual(1);
    expect(crop.y + crop.height).toBeLessThanOrEqual(1);
  });

  it("shifts the crop downward to include shoulders", () => {
    const face = { x: 0.4, y: 0.4, width: 0.1, height: 0.1 };
    const crop = expandFaceToFacecamCrop(face);
    const faceCenter = rectCenter(face);
    const cropCenter = rectCenter(crop);
    expect(cropCenter.y).toBeGreaterThan(faceCenter.y);
  });
});

describe("rect metrics", () => {
  it("computes IoU of identical rects as 1", () => {
    const rect = { x: 0.2, y: 0.2, width: 0.3, height: 0.3 };
    expect(rectIoU(rect, rect)).toBeCloseTo(1);
  });

  it("computes IoU of disjoint rects as 0", () => {
    expect(
      rectIoU(
        { x: 0, y: 0, width: 0.2, height: 0.2 },
        { x: 0.5, y: 0.5, width: 0.2, height: 0.2 }
      )
    ).toBe(0);
  });

  it("computes center distance", () => {
    const distance = rectCenterDistance(
      { x: 0, y: 0, width: 0.2, height: 0.2 },
      { x: 0.3, y: 0, width: 0.2, height: 0.2 }
    );
    expect(distance).toBeCloseTo(0.3);
  });

  it("computes medians robust to outliers", () => {
    expect(median([1, 2, 3, 4, 100])).toBe(3);
    const rects = [
      { x: 0.5, y: 0.5, width: 0.1, height: 0.1 },
      { x: 0.5, y: 0.5, width: 0.1, height: 0.1 },
      { x: 0.01, y: 0.01, width: 0.9, height: 0.9 },
    ];
    const rect = medianRect(rects)!;
    expect(rect.x).toBeCloseTo(0.5);
    expect(rect.width).toBeCloseTo(0.1);
  });
});
