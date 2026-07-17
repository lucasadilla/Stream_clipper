import path from "path";
import { existsSync, statSync } from "fs";
import { rename, stat, unlink } from "fs/promises";
import {
  getFfmpegPath,
  hasAudioStream,
  probeMediaDurationBestEffort,
  runCommand,
} from "@/lib/ffmpeg";
import {
  getUploadDir,
  toRelativeStoragePath,
  resolveStoragePath,
  fileExists,
  listSourceCandidateFiles,
} from "@/lib/storage";

const PREVIEW_FILENAME = "preview.mp4";
const MIN_PREVIEW_BYTES = 48 * 1024;
const REMUX_INTERVAL_MS = 60_000;

const lastRemuxAt = new Map<string, number>();
const remuxInFlight = new Set<string>();

export function getPreviewMp4Path(streamSessionId: string): string {
  return path.join(getUploadDir(streamSessionId), PREVIEW_FILENAME);
}

export async function previewMp4Ready(
  streamSessionId: string
): Promise<boolean> {
  const full = getPreviewMp4Path(streamSessionId);
  if (!existsSync(full)) return false;
  try {
    const s = await stat(full);
    if (s.size < MIN_PREVIEW_BYTES) return false;
    const probe = await probeMediaDurationBestEffort(full);
    // Require a real playable stretch — 1s stubs looked "ready" then played black.
    return probe >= 3;
  } catch {
    return false;
  }
}

export function getPreviewVideoRelativePath(
  streamSessionId: string
): string | null {
  const relative = toRelativeStoragePath(getPreviewMp4Path(streamSessionId));
  return fileExists(relative) ? relative : null;
}

/**
 * Find a companion audio-only yt-dlp track (e.g. source.f140.mkv) when the
 * primary capture is video-only. Needed so preview A/V matches transcription.
 */
async function findCompanionAudioPath(
  streamSessionId: string,
  videoPath: string
): Promise<string | null> {
  if (await hasAudioStream(videoPath)) return null;

  const candidates = await listSourceCandidateFiles(getUploadDir(streamSessionId));
  for (const candidate of candidates) {
    if (candidate === videoPath) continue;
    if (await hasAudioStream(candidate)) return candidate;
  }
  return null;
}

/**
 * Remux the growing capture (usually .mkv) into browser-playable MP4 for preview.
 * When yt-dlp splits video/audio, merge both so playback stays in sync with Whisper.
 * Throttled — safe to call on every live sync tick.
 */
export async function syncPreviewMp4(
  streamSessionId: string,
  sourceAbsolutePath: string
): Promise<void> {
  if (!existsSync(sourceAbsolutePath)) return;

  const ext = path.extname(sourceAbsolutePath).toLowerCase();
  if (ext === ".mp4" || ext === ".m4v" || ext === ".webm") return;

  const now = Date.now();
  const last = lastRemuxAt.get(streamSessionId) ?? 0;
  if (now - last < REMUX_INTERVAL_MS) return;
  if (remuxInFlight.has(streamSessionId)) return;

  remuxInFlight.add(streamSessionId);
  const outputPath = getPreviewMp4Path(streamSessionId);
  const tempPath = `${outputPath}.${process.pid}-${Date.now()}.tmp.mp4`;

  try {
    const companionAudio = await findCompanionAudioPath(
      streamSessionId,
      sourceAbsolutePath
    );

    const videoSeconds = await probeMediaDurationBestEffort(
      sourceAbsolutePath
    ).catch(() => 0);
    const audioSeconds = companionAudio
      ? await probeMediaDurationBestEffort(companionAudio).catch(() => 0)
      : 0;
    const readableSeconds = Math.max(videoSeconds, audioSeconds);
    if (readableSeconds < 1) return;

    const args = [
      "-y",
      "-nostdin",
      "-loglevel",
      "error",
      "-i",
      sourceAbsolutePath,
    ];

    if (companionAudio) {
      // Separate DASH tracks — mux video + audio so captions match what you hear.
      args.push("-i", companionAudio, "-t", String(readableSeconds));
      args.push(
        "-map",
        "0:v:0?",
        "-map",
        "1:a:0?",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "160k",
        "-shortest"
      );
    } else {
      args.push(
        "-t",
        String(readableSeconds),
        "-map",
        "0:v:0?",
        "-map",
        "0:a:0?",
        "-c",
        "copy"
      );
    }

    args.push("-movflags", "+faststart", tempPath);

    await runCommand(getFfmpegPath(), args);
    // Never expose a half-written MP4. rename() makes the finalized moov atom
    // and media data visible together to browsers and render jobs.
    await rename(tempPath, outputPath);
    lastRemuxAt.set(streamSessionId, Date.now());
  } catch {
    // Growing file may be locked or incomplete — retry on next tick.
  } finally {
    await unlink(tempPath).catch(() => {});
    remuxInFlight.delete(streamSessionId);
  }
}

export function buildPreviewVideoUrl(relativePath: string | null): string | null {
  if (!relativePath || !fileExists(relativePath)) return null;
  let version = Date.now();
  try {
    // mtime changes when remux rewrites preview.mp4 — bust browser cache.
    version = Math.floor(statSync(resolveStoragePath(relativePath)).mtimeMs);
  } catch {
    // keep Date.now()
  }
  return `/api/storage/${relativePath.replace(/\\/g, "/")}?inline=1&v=${version}`;
}

export function resolvePlaybackVideoUrl(options: {
  previewVideoUrl?: string | null;
  sourceVideoUrl?: string | null;
  sourceIsPlayableMp4?: boolean;
}): string | null {
  if (options.previewVideoUrl) return options.previewVideoUrl;
  if (options.sourceIsPlayableMp4 && options.sourceVideoUrl) {
    return options.sourceVideoUrl;
  }
  return null;
}
