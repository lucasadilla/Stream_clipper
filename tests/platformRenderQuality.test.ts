import { describe, expect, it } from "vitest";
import { buildPlatformVideoFilters } from "@/services/platformRenderService";
import { platformSettings } from "@/lib/platforms/presets";

function renderInput(sourceIncludesCaptions: boolean) {
  return {
    platform: "youtube_shorts" as const,
    inputPath: "master.mp4",
    outputPath: "shorts.mp4",
    thumbnailPath: "cover.jpg",
    settings: platformSettings("youtube_shorts", {
      includeCaptions: true,
      burnSubtitles: true,
      generateCopy: true,
      xQuoteCard: false,
    }),
    subtitlePath: "captions.ass",
    sourceIncludesCaptions,
  };
}

describe("platform render quality", () => {
  it("uses high-quality scaling for platform transforms", () => {
    const filters = buildPlatformVideoFilters(renderInput(false), false);
    expect(filters[0]).toContain("flags=lanczos");
  });

  it("does not burn captions twice when the master already has them", () => {
    const filters = buildPlatformVideoFilters(renderInput(true), false);
    expect(filters).toHaveLength(1);
    expect(filters.join(",")).not.toContain("subtitles=");
  });

  it("burns captions when the source master does not contain them", () => {
    const filters = buildPlatformVideoFilters(renderInput(false), false);
    expect(filters.join(",")).toContain("subtitles=");
  });
});
