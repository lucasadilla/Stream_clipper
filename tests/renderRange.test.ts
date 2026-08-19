import { describe, expect, it } from "vitest";
import { rangeCoversWholeSource } from "@/lib/renderRange";

describe("render source copy range", () => {
  it("does not copy a cached segment when only a subsection was selected", () => {
    expect(rangeCoversWholeSource(0, 10, 40)).toBe(false);
  });

  it("allows copying when the requested range covers the whole source", () => {
    expect(rangeCoversWholeSource(0, 39.98, 40)).toBe(true);
  });

  it("does not copy when source duration is unknown", () => {
    expect(rangeCoversWholeSource(0, 10, null)).toBe(false);
  });
});
