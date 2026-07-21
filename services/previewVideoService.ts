import path from "path";
import { createReadStream, createWriteStream, existsSync, statSync } from "fs";
import { copyFile, rename, stat, unlink } from "fs/promises";
import { pipeline } from "stream/promises";
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
  isMergedSourceFile,
} from "@/lib/storage";

const PREVIEW_FILENAME = "preview.mp4";
const MIN_PREVIEW_BYTES = 48 * 1024;
/** After preview is caught up with source, wait this long before rewriting again. */
const REMUX_INTERVAL_MS = 60_000;
/** While preview is missing or far behind the capture, remux more often. */
const CATCHUP_REMUX_INTERVAL_MS = 20_000;
const FIRST_REMUX_INTERVAL_MS = 8_000;
/**
 * Conservative bytes/sec for under-probed growing captures.
 * Prefer OVER-estimating duration so we keep remuxing as the file grows.
 * (~640 kbps — below typical Twitch 720p/1080p so size→seconds stays high.)
 */
const BYTES_PER_SECOND_ESTIMATE = 80 * 1024;
const MIN_BYTES_FOR_SIZE_ESTIMATE = 500_000;
/** Remux whenever the source grew by this much, even if duration probes agree. */
const MIN_SOURCE_GROWTH_BYTES = 2 * 1024 * 1024;
/** Abandon a hung remux so later sync ticks can retry. */
const REMUX_STALE_MS = 12 * 60_000;

const lastRemuxAt = new Map<string, number>();
const lastRemuxSourceBytes = new Map<string, number>();
const remuxInFlight = new Map<string, number>(); // sessionId → startedAt

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

function estimateSecondsFromBytes(sizeBytes: number): number {
  if (sizeBytes < MIN_BYTES_FOR_SIZE_ESTIMATE) return 0;
  return sizeBytes / BYTES_PER_SECOND_ESTIMATE;
}

/**
 * Growing MKV/HLS captures often report a stale/short format.duration while
 * the file on disk already holds much more media. Take the max of probe + size.
 */
async function resolveReadableSeconds(filePath: string): Promise<number> {
  const probed = await probeMediaDurationBestEffort(filePath).catch(() => 0);
  let sizeBytes = 0;
  try {
    sizeBytes = (await stat(filePath)).size;
  } catch {
    // ignore
  }
  return Math.max(probed, estimateSecondsFromBytes(sizeBytes));
}

/**
 * yt-dlp split tracks (`source.f399.mp4`) and .mkv need a finalized faststart
 * preview. Browsers only play a short prefix of incomplete progressive MP4s.
 * Merged `source.mp4` with audio can play directly.
 */
export function sourceNeedsPreviewRemux(sourceAbsolutePath: string): boolean {
  const base = path.basename(sourceAbsolutePath);
  if (/^preview\.mp4$/i.test(base)) return false;
  if (/^source\.f\d+\./i.test(base)) return true;
  const ext = path.extname(base).toLowerCase();
  if (ext === ".mkv" || ext === ".ts") return true;
  if (
    isMergedSourceFile(base) &&
    (ext === ".mp4" || ext === ".webm" || ext === ".m4v" || ext === ".mov")
  ) {
    return false;
  }
  return true;
}

/** Copy a growing capture to a stable snapshot ffmpeg can remux reliably. */
async function snapshotFile(
  sourcePath: string,
  destPath: string
): Promise<number> {
  try {
    await copyFile(sourcePath, destPath);
  } catch {
    // Fall back to streamed copy when the source is locked for exclusive access.
    await pipeline(createReadStream(sourcePath), createWriteStream(destPath));
  }
  return (await stat(destPath)).size;
}

/**
 * Remux the growing capture into browser-playable MP4 for preview.
 * When yt-dlp splits video/audio, merge both so playback stays in sync with Whisper.
 * Throttled — safe to call on every live sync tick.
 */
export async function syncPreviewMp4(
  streamSessionId: string,
  sourceAbsolutePath: string
): Promise<void> {
  if (!existsSync(sourceAbsolutePath)) return;
  if (!sourceNeedsPreviewRemux(sourceAbsolutePath)) {
    if (!(await hasAudioStream(sourceAbsolutePath).catch(() => false))) {
      // fall through — video-only merged files still need a muxed preview
    } else {
      return;
    }
  }

  const now = Date.now();
  const inFlightSince = remuxInFlight.get(streamSessionId);
  if (inFlightSince != null) {
    if (now - inFlightSince < REMUX_STALE_MS) return;
    // Hung remux (multi-hour faststart can wedge) — allow a retry.
    remuxInFlight.delete(streamSessionId);
  }

  const last = lastRemuxAt.get(streamSessionId) ?? 0;
  const outputPath = getPreviewMp4Path(streamSessionId);
  const hasPreview = await previewMp4Ready(streamSessionId);

  let sourceBytes = 0;
  try {
    sourceBytes = (await stat(sourceAbsolutePath)).size;
  } catch {
    return;
  }

  const sourceSeconds = await resolveReadableSeconds(sourceAbsolutePath);
  if (sourceSeconds < 1 && sourceBytes < MIN_BYTES_FOR_SIZE_ESTIMATE) return;

  let previewSeconds = 0;
  if (hasPreview) {
    previewSeconds = await probeMediaDurationBestEffort(outputPath).catch(
      () => 0
    );
  }

  const prevSourceBytes = lastRemuxSourceBytes.get(streamSessionId) ?? 0;
  const grewBytes = sourceBytes - prevSourceBytes;
  const behindBy = Math.max(0, sourceSeconds - previewSeconds);
  const needsCatchup =
    !hasPreview || behindBy >= 8 || grewBytes >= MIN_SOURCE_GROWTH_BYTES;

  if (!needsCatchup) {
    lastRemuxAt.set(streamSessionId, now);
    return;
  }

  const interval = !hasPreview
    ? FIRST_REMUX_INTERVAL_MS
    : behindBy >= 60 || grewBytes >= MIN_SOURCE_GROWTH_BYTES * 4
      ? CATCHUP_REMUX_INTERVAL_MS
      : REMUX_INTERVAL_MS;
  if (now - last < interval) return;

  remuxInFlight.set(streamSessionId, now);
  const uploadDir = getUploadDir(streamSessionId);
  const stamp = `${process.pid}-${Date.now()}`;
  const tempPath = path.join(uploadDir, `preview.${stamp}.tmp.mp4`);
  const snapVideo = path.join(uploadDir, `preview-src.${stamp}.snap`);
  const snapAudio = path.join(uploadDir, `preview-aud.${stamp}.snap`);

  try {
    const companionAudio = await findCompanionAudioPath(
      streamSessionId,
      sourceAbsolutePath
    );

    // Snapshot so yt-dlp can keep writing while we remux a stable copy.
    const snappedVideoBytes = await snapshotFile(sourceAbsolutePath, snapVideo);
    let snappedAudioPath: string | null = null;
    let audioSeconds = 0;
    if (companionAudio) {
      await snapshotFile(companionAudio, snapAudio);
      snappedAudioPath = snapAudio;
      audioSeconds = await resolveReadableSeconds(snapAudio).catch(() => 0);
    }

    const videoSeconds = await resolveReadableSeconds(snapVideo).catch(() => 0);
    const readableSeconds = Math.max(
      videoSeconds,
      audioSeconds,
      estimateSecondsFromBytes(snappedVideoBytes),
      sourceSeconds,
      1
    );

    const args = [
      "-y",
      "-nostdin",
      "-loglevel",
      "error",
      "-err_detect",
      "ignore_err",
      "-fflags",
      "+genpts+igndts",
      "-i",
      snapVideo,
    ];

    if (snappedAudioPath) {
      // Explicit -t from the best duration estimate — never -shortest, which
      // capped multi-hour Twitch captures when companion audio lagged.
      args.push("-i", snappedAudioPath, "-t", String(readableSeconds));
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
        "160k"
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

    const remuxedSeconds = await probeMediaDurationBestEffort(tempPath).catch(
      () => 0
    );
    // Keep the longer preview if a remux somehow produced a shorter file
    // (partial read of a growing source).
    if (hasPreview && remuxedSeconds + 2 < previewSeconds) {
      await unlink(tempPath).catch(() => {});
      lastRemuxAt.set(streamSessionId, Date.now());
      lastRemuxSourceBytes.set(streamSessionId, sourceBytes);
      return;
    }

    await rename(tempPath, outputPath);
    lastRemuxAt.set(streamSessionId, Date.now());
    lastRemuxSourceBytes.set(streamSessionId, sourceBytes);
  } catch {
    // Growing file may be locked or incomplete — retry on next tick.
    lastRemuxAt.set(
      streamSessionId,
      Date.now() - interval + Math.min(interval, 8_000)
    );
  } finally {
    await Promise.all([
      unlink(tempPath).catch(() => {}),
      unlink(snapVideo).catch(() => {}),
      unlink(snapAudio).catch(() => {}),
    ]);
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
