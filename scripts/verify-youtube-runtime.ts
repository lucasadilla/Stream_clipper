import { loadEnvConfig } from "@next/env";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getFfmpegPath, getFfmpegVersion, probeMedia, runCommand } from "../lib/ffmpeg";
import {
  classifyYtDlpError,
  downloadClipSegmentFromStream,
  formatYtDlpUserError,
  getYoutubeCookieStatus,
  getYtDlpVersion,
} from "../services/youtubeDownloadService";

loadEnvConfig(process.cwd());

class VerificationError extends Error {}

async function main() {
  const url = process.argv[2]?.trim();
  if (!url) {
    throw new VerificationError(
      "Pass an authorized YouTube URL: npm run youtube:verify -- https://www.youtube.com/watch?v=VIDEO_ID [startSeconds]"
    );
  }
  let hostname: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") throw new Error();
    hostname = parsed.hostname;
  } catch {
    throw new VerificationError("Pass a valid HTTPS YouTube video URL.");
  }
  if (hostname !== "youtu.be" && hostname !== "youtube.com" && !hostname.endsWith(".youtube.com")) {
    throw new VerificationError("Pass a YouTube video URL.");
  }
  const startSeconds = Number(process.argv[3] ?? 0);
  if (!Number.isFinite(startSeconds) || startSeconds < 0 || process.argv.length > 4) {
    throw new VerificationError("Optional startSeconds must be a non-negative number.");
  }

  const [ffmpegVersion, ytDlpVersion, cookieStatus] = await Promise.all([
    getFfmpegVersion(),
    getYtDlpVersion(),
    getYoutubeCookieStatus(),
  ]);
  if (!ffmpegVersion) throw new VerificationError("FFmpeg is not installed or is not on PATH.");
  if (!ytDlpVersion) throw new VerificationError("yt-dlp is not installed or is not on PATH.");
  console.log(`FFmpeg: ${ffmpegVersion}`);
  console.log(`yt-dlp: ${ytDlpVersion}`);
  if (cookieStatus.configured && !cookieStatus.valid) {
    throw new VerificationError("Configured YouTube cookies are invalid. Replace or remove them before testing.");
  }
  console.log(cookieStatus.configured
    ? "YouTube cookies: file format valid; login acceptance unverified"
    : "YouTube cookies: not configured; testing public access");
  console.log(`Capture connection: ${process.env.YT_DLP_PROXY?.trim() ? "configured proxy" : "direct"}`);
  console.log("Downloading an 8-second HD sample through the export capture pipeline…");

  const directory = await mkdtemp(path.join(os.tmpdir(), "clipper-capture-check-"));
  try {
    const sample = path.join(directory, "sample.mp4");
    await downloadClipSegmentFromStream(url, String(startSeconds), String(startSeconds + 8), sample, {
      timeoutMs: 120_000,
      attemptTimeoutMs: 30_000,
      minVideoHeight: 720,
    });
    const media = await probeMedia(sample);
    if (media.height < 720 || !media.videoCodec || !media.audioCodec || media.durationSeconds < 4) {
      throw new VerificationError("Capture failed verification: need at least 4 seconds of HD video with audio. Choose a start time away from the end of the video.");
    }
    // Metadata alone can pass even when the CDN refuses actual media. Decode
    // both streams before declaring this connection suitable for exports.
    await runCommand(getFfmpegPath(), [
      "-v", "error", "-xerror", "-err_detect", "explode", "-i", sample,
      "-map", "0:v:0", "-map", "0:a:0", "-t", "8", "-f", "null", "-",
    ], { timeoutMs: 30_000 });
    console.log(`Media capture passed: ${media.width}×${media.height}, ${media.fps.toFixed(2)} fps, ${media.durationSeconds.toFixed(2)}s, audio ${media.audioCodec}.`);
    console.log("This verifies this connection now; run the same check on Railway before declaring server capture restored.");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  // Raw yt-dlp/FFmpeg errors can contain proxy credentials or signed CDN URLs.
  console.error(error instanceof VerificationError
    ? error.message
    : classifyYtDlpError(error) !== "unknown"
      ? formatYtDlpUserError(error)
      : "Media capture verification failed. Check the capture connection, FFmpeg/ffprobe installation, and video availability.");
  process.exitCode = 1;
});
