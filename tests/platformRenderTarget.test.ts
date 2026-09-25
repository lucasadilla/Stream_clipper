import { describe, expect, it } from "vitest";
import { parsePlatformRenderTarget, platformRenderDimensions } from "@/lib/platforms/renderTarget";
import { PLATFORM_KEYS, PLATFORM_PRESETS } from "@/lib/platforms/presets";
import { buildTechnicalQualityReview } from "@/lib/postRenderCritic";

describe("platform render dimensions", () => {
  it.each(PLATFORM_KEYS)("renders and validates every %s output at its actual dimensions", (platform) => {
    for (const output of PLATFORM_PRESETS[platform].outputs) {
      const target = parsePlatformRenderTarget({ platform, outputId: output.id });
      expect(target).toBeDefined();
      const dimensions = platformRenderDimensions(target!);
      expect(dimensions).toEqual(output);
      const review = buildTechnicalQualityReview({
        ...dimensions, expectedDimensions: dimensions,
        durationSeconds: 30, expectedDurationSeconds: 30, fps: 60,
        videoCodec: "h264", audioCodec: "aac", fileSizeBytes: 8_000_000,
        format: "vertical", expectsAudio: true, expectsCaptions: false,
      });
      expect(review.verdict).toBe("pass");
    }
  });

  it("rejects unknown platforms and arbitrary output sizes", () => {
    expect(parsePlatformRenderTarget({ platform: "unknown", outputId: "vertical" })).toBeUndefined();
    expect(parsePlatformRenderTarget({ platform: "tiktok", outputId: "8k" })).toBeUndefined();
  });
});
