import path from "path";
import fs from "fs/promises";
import { prisma } from "@/lib/db";
import { runCommand, getFfmpegPath } from "@/lib/ffmpeg";
import { probeMedia } from "@/lib/ffmpeg";
import { toJsonValue } from "@/lib/utils";
import {
  getUploadDir,
  ensureDir,
  toRelativeStoragePath,
} from "@/lib/storage";

export function getYtDlpPath(): string {
  return process.env.YT_DLP_PATH ?? "yt-dlp";
}

function getFfmpegLocationDir(): string {
  return path.dirname(getFfmpegPath());
}

function getYtDlpJsRuntimeArg(): string {
  const configured = process.env.YT_DLP_JS_RUNTIME;
  if (configured) return configured;
  // yt-dlp needs an explicit path on Windows; use the Node running this app
  return `node:${process.execPath}`;
}

function baseYtDlpArgs(): string[] {
  return [
    "--js-runtimes",
    getYtDlpJsRuntimeArg(),
    "--no-playlist",
    "--ffmpeg-location",
    getFfmpegLocationDir(),
  ];
}

export async function isYtDlpAvailable(): Promise<boolean> {
  try {
    await runCommand(getYtDlpPath(), ["--version"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Download video from the session's YouTube URL via yt-dlp.
 * Requires yt-dlp installed: https://github.com/yt-dlp/yt-dlp
 */
export async function downloadSourceFromYouTube(streamSessionId: string) {
  const session = await prisma.streamSession.findUnique({
    where: { id: streamSessionId },
    include: { sourceMedia: { take: 1 } },
  });

  if (!session) throw new Error("Session not found");

  // Skip if already downloaded (not an in-progress live buffer)
  const existing = session.sourceMedia[0];
  if (existing && !existing.isLiveRecording && (existing.durationSeconds ?? 0) > 0) {
    return existing;
  }

  const available = await isYtDlpAvailable();
  if (!available) {
    throw new Error(
      "yt-dlp is not installed. Install it from https://github.com/yt-dlp/yt-dlp and ensure it is on your PATH (or set YT_DLP_PATH in .env)."
    );
  }

  const uploadDir = getUploadDir(streamSessionId);
  await ensureDir(uploadDir);

  const outputPath = path.join(uploadDir, "source.mp4");

  const args = [
    ...baseYtDlpArgs(),
    "-f",
    "best[height<=1080][ext=mp4]/best[height<=1080]/best",
    "-o",
    outputPath,
    session.youtubeUrl,
  ];

  await runCommand(getYtDlpPath(), args);

  // yt-dlp may write source.mp4 or source.f140.m4a etc. — find the output file
  let absolutePath = outputPath;
  try {
    await fs.access(absolutePath);
  } catch {
    const files = await fs.readdir(uploadDir);
    const videoFile = files.find(
      (f) =>
        f.startsWith("source.") &&
        !f.endsWith(".part") &&
        !f.endsWith(".ytdl")
    );
    if (!videoFile) {
      throw new Error("Download completed but output file was not found");
    }
    absolutePath = path.join(uploadDir, videoFile);
  }

  const stat = await fs.stat(absolutePath);
  const relativePath = toRelativeStoragePath(absolutePath);

  let probe;
  try {
    probe = await probeMedia(absolutePath);
  } catch {
    probe = {
      durationSeconds: 0,
      width: 0,
      height: 0,
      fps: 0,
      videoCodec: null,
      audioCodec: null,
      raw: {},
    };
  }

  await prisma.sourceMedia.deleteMany({ where: { streamSessionId } });

  return prisma.sourceMedia.create({
    data: {
      streamSessionId,
      originalFilename: `${session.youtubeVideoId}.mp4`,
      filePath: relativePath,
      mimeType: "video/mp4",
      sizeBytes: BigInt(stat.size),
      durationSeconds: probe.durationSeconds || null,
      width: probe.width || null,
      height: probe.height || null,
      fps: probe.fps || null,
      codecInfo: toJsonValue(probe.raw),
      isLiveRecording: false,
    },
  });
}

/** Download only the time range needed for a clip (fast — no full VOD download). */
export async function downloadClipSegmentFromYouTube(
  youtubeUrl: string,
  startTime: string,
  endTime: string,
  outputPath: string
) {
  const available = await isYtDlpAvailable();
  if (!available) {
    throw new Error("yt-dlp is not installed. Set YT_DLP_PATH in .env.");
  }

  const section = `*${startTime}-${endTime}`;

  const args = [
    ...baseYtDlpArgs(),
    "--download-sections",
    section,
    "--force-keyframes-at-cuts",
    "-f",
    "best[height<=1080][ext=mp4]/best[height<=1080]/best",
    "-o",
    outputPath,
    youtubeUrl,
  ];

  await runCommand(getYtDlpPath(), args);
}
