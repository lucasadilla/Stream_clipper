import { describe, expect, it } from "vitest";
import { parseFfmpegProgressSeconds } from "@/lib/ffmpeg";
import { isRetryableRenderFailure } from "@/lib/renderReliability";
import { renderSpecHash, storedRenderSpecHash } from "@/lib/renderSpec";
import { parseYtDlpProgress } from "@/services/youtubeDownloadService";

describe("render reliability", () => {
  it("parses machine-readable FFmpeg progress", () => {
    expect(parseFfmpegProgressSeconds("out_time=00:01:12.500000")).toBe(72.5);
    expect(parseFfmpegProgressSeconds("frame=1800")).toBeNull();
  });

  it("parses yt-dlp download progress", () => {
    expect(parseYtDlpProgress("clipper-progress: 42.7%")).toBeCloseTo(0.427);
    expect(parseYtDlpProgress("[download] Destination: clip.mp4")).toBeNull();
  });

  it("does not replay an exhausted source acquisition failure", () => {
    expect(
      isRetryableRenderFailure(
        "Could not retrieve the full-quality source video. Retry the render."
      )
    ).toBe(false);
    expect(isRetryableRenderFailure("ffmpeg timed out after 120s")).toBe(false);
    expect(isRetryableRenderFailure("ECONNRESET while writing output")).toBe(true);
  });

  it("deduplicates equivalent render specifications regardless of key order", () => {
    const left = renderSpecHash({
      format: "vertical",
      captions: { enabled: true, style: "bold" },
    });
    const right = renderSpecHash({
      captions: { style: "bold", enabled: true },
      format: "vertical",
    });
    expect(left).toBe(right);
    expect(storedRenderSpecHash({ renderSpecHash: left })).toBe(left);
  });
});
