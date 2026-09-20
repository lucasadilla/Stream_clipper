import { describe, expect, it } from "vitest";
import {
  isPreviewRenderJobParams,
  selectLatestFinalRenderJob,
} from "@/lib/renderJobSelection";

describe("render job selection", () => {
  it("recognizes only explicitly marked preview jobs", () => {
    expect(isPreviewRenderJobParams({ preview: true })).toBe(true);
    expect(isPreviewRenderJobParams({ preview: false })).toBe(false);
    expect(isPreviewRenderJobParams({ format: "vertical" })).toBe(false);
    expect(isPreviewRenderJobParams(null)).toBe(false);
  });

  it("skips a newer preview and returns the latest final export", () => {
    const jobs = [
      { id: "preview", outputPath: "preview.mp4", params: { preview: true } },
      { id: "final", outputPath: "final.mp4", params: { preview: false } },
      { id: "old", outputPath: "old.mp4", params: {} },
    ];

    expect(selectLatestFinalRenderJob(jobs)?.id).toBe("final");
  });

  it("supports final jobs created before the preview flag existed", () => {
    const jobs = [
      { id: "legacy", outputPath: "legacy.mp4", params: { format: "vertical" } },
    ];

    expect(selectLatestFinalRenderJob(jobs)?.id).toBe("legacy");
  });
});
