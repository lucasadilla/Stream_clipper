import { afterEach, describe, expect, it, vi } from "vitest";
import { runYtDlp } from "@/services/youtubeDownloadService";
import {
  YoutubeCapturePausedError,
  clearYoutubeCaptureChallenge,
  recordYoutubeCaptureChallenge,
  youtubeCaptureRetryAt,
} from "@/lib/youtubeCaptureBackoff";

const url = "https://www.youtube.com/watch?v=HzraLR2VkNM";
afterEach(() => {
  clearYoutubeCaptureChallenge(url);
  vi.useRealTimers();
});

describe("blocked YouTube capture backoff", () => {
  it("suppresses background retries across sessions and URL variants but allows foreground fallback clients", () => {
    recordYoutubeCaptureChallenge(url);
    expect(youtubeCaptureRetryAt("https://youtu.be/HzraLR2VkNM", true)).toBeGreaterThan(Date.now());
    expect(youtubeCaptureRetryAt(url)).toBeNull();
    expect(youtubeCaptureRetryAt("https://www.youtube.com/watch?v=abcdefghijk", true)).toBeNull();
    expect(youtubeCaptureRetryAt("https://twitch.tv/channel", true)).toBeNull();
  });

  it("pauses foreground retries only after the downloader exhausts its routes", () => {
    vi.useFakeTimers();
    recordYoutubeCaptureChallenge(url, true);
    const retryAt = youtubeCaptureRetryAt(url)!;
    expect(retryAt - Date.now()).toBe(5 * 60_000);
    vi.advanceTimersByTime(60_000);
    recordYoutubeCaptureChallenge(url);
    // Parallel failures don't extend the pause indefinitely or erase exhaustion.
    expect(youtubeCaptureRetryAt(url)).toBe(retryAt);
    vi.advanceTimersByTime(4 * 60_000);
    expect(youtubeCaptureRetryAt(url)).toBeNull();
    recordYoutubeCaptureChallenge(url, true);
    expect(youtubeCaptureRetryAt(url)! - Date.now()).toBe(10 * 60_000);
  });

  it("rejects metadata and media retries before starting another yt-dlp process", async () => {
    recordYoutubeCaptureChallenge(url, true);
    await expect(runYtDlp(["--skip-download", "--dump-single-json"], url))
      .rejects.toBeInstanceOf(YoutubeCapturePausedError);
    await expect(runYtDlp(["-f", "bestaudio"], "https://youtu.be/HzraLR2VkNM"))
      .rejects.toBeInstanceOf(YoutubeCapturePausedError);
  });

  it("clears the pause after a successful download", () => {
    recordYoutubeCaptureChallenge(url, true);
    clearYoutubeCaptureChallenge(url);
    expect(youtubeCaptureRetryAt(url)).toBeNull();
    expect(youtubeCaptureRetryAt(url, true)).toBeNull();
  });
});
