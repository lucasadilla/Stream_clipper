import { describe, expect, it } from "vitest";
import {
  buildCriticSampleTimes,
  buildTechnicalQualityReview,
  mergeAiQualityReview,
} from "@/lib/postRenderCritic";

describe("post-render quality critic", () => {
  it("does not give an upscaled 360p source a perfect quality score", () => {
    const review = buildTechnicalQualityReview({
      durationSeconds: 30, expectedDurationSeconds: 30, width: 1080, height: 1920,
      fps: 30, videoCodec: "h264", audioCodec: "aac", fileSizeBytes: 90_000_000,
      format: "vertical", expectsAudio: true, expectsCaptions: true,
      sourceDimensions: { width: 640, height: 360 },
    });
    expect(review.verdict).toBe("review");
    expect(review.scores.clarity).toBe(40);
    expect(review.issues[0].title).toContain("Source video");
  });
  it("samples the opening, ending, and both sides of edit boundaries", () => {
    const times = buildCriticSampleTimes(30, [10], 6);

    expect(times).toHaveLength(6);
    expect(times[0]).toBeLessThan(1);
    expect(times.at(-1)).toBeGreaterThan(29);
    expect(times.some((time) => Math.abs(time - 9.9) < 0.15)).toBe(true);
    expect(times.some((time) => Math.abs(time - 10.1) < 0.15)).toBe(true);
  });

  it("passes a healthy full-HD vertical export", () => {
    const review = buildTechnicalQualityReview({
      durationSeconds: 29.98,
      expectedDurationSeconds: 30,
      width: 1080,
      height: 1920,
      fps: 30,
      videoCodec: "h264",
      audioCodec: "aac",
      fileSizeBytes: 8_000_000,
      format: "vertical",
      expectsAudio: true,
      expectsCaptions: true,
    });

    expect(review.verdict).toBe("pass");
    expect(review.score).toBe(100);
    expect(review.issues).toEqual([]);
  });

  it("fails exports with missing audio and a materially wrong duration", () => {
    const review = buildTechnicalQualityReview({
      durationSeconds: 17,
      expectedDurationSeconds: 30,
      width: 1080,
      height: 1920,
      fps: 30,
      videoCodec: "h264",
      audioCodec: null,
      fileSizeBytes: 3_000_000,
      format: "vertical",
      expectsAudio: true,
      expectsCaptions: true,
    });

    expect(review.verdict).toBe("fail");
    expect(review.issues.map((issue) => issue.category)).toEqual(
      expect.arrayContaining(["cuts", "audio"])
    );
  });

  it("drops visual issues that do not point to an inspected frame", () => {
    const technical = buildTechnicalQualityReview({
      durationSeconds: 20,
      expectedDurationSeconds: 20,
      width: 1080,
      height: 1920,
      fps: 30,
      videoCodec: "h264",
      audioCodec: "aac",
      fileSizeBytes: 4_000_000,
      format: "vertical",
      expectsAudio: true,
      expectsCaptions: true,
    });
    const merged = mergeAiQualityReview(
      technical,
      {
        summary: "The clip is visually clean overall.",
        scores: {
          framing: 92,
          captions: 90,
          cuts: 94,
          clarity: 95,
          platformReadiness: 92,
        },
        issues: [
          {
            severity: "warning",
            category: "framing",
            timestampSeconds: 12,
            title: "Subject is cropped",
            evidence: "The subject is outside the safe area.",
            recommendation: "Reframe the subject.",
          },
        ],
        strengths: ["Captions are readable"],
      },
      {
        model: "vision-test",
        samplesReviewed: 3,
        durationSeconds: 20,
        sampleTimes: [0.3, 5, 19.7],
      }
    );

    expect(merged.reviewer).toBe("ai_visual");
    expect(merged.issues).toEqual([]);
    expect(merged.verdict).toBe("pass");
  });
});
