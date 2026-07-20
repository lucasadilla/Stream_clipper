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
/** After preview is caught up with source, wait this long before rewriting again. */
const REMUX_INTERVAL_MS = 45_000;
/** While preview is missing or far behind the capture, remux more often. */
const CATCHUP_REMUX_INTERVAL_MS = 12_000;
const FIRST_REMUX_INTERVAL_MS = 8_000;
/** ~300 KB/s — same ballpark as liveRecordingService for growing captures. */
const BYTES_PER_SECOND_ESTIMATE = 300 * 1024;
const MIN_BYTES_FOR_SIZE_ESTIMATE = 500_000;

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
 * Remux the growing capture (usually .mkv) into browser-playable MP4 for preview.
 * When yt-dlp splits video/audio, merge both so playback stays in sync with Whisper.
 * Throttled — safe to call on every live sync tick.
 *
 * Important: do NOT truncate with a probed `-t` for single-file remux. Growing
 * captures often under-report duration (e.g. stuck at ~30 min), which produced a
 * short scrubbable preview while the live stream was hours long.
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
  if (remuxInFlight.has(streamSessionId)) return;

  const outputPath = getPreviewMp4Path(streamSessionId);
  const hasPreview = await previewMp4Ready(streamSessionId);
  const sourceSeconds = await resolveReadableSeconds(sourceAbsolutePath);
  if (sourceSeconds < 1) return;

  let previewSeconds = 0;
  if (hasPreview) {
    previewSeconds = await probeMediaDurationBestEffort(outputPath).catch(() => 0);
  }

  // Remux when missing, or when capture has grown meaningfully past the preview.
  const behindBy = sourceSeconds - previewSeconds;
  const needsCatchup = !hasPreview || behindBy >= 8;
  if (!needsCatchup) {
    lastRemuxAt.set(streamSessionId, now);
    return;
  }

  const interval = !hasPreview
    ? FIRST_REMUX_INTERVAL_MS
    : behindBy >= 30
      ? CATCHUP_REMUX_INTERVAL_MS
      : REMUX_INTERVAL_MS;
  if (now - last < interval) return;

  remuxInFlight.add(streamSessionId);
  const tempPath = `${outputPath}.${process.pid}-${Date.now()}.tmp.mp4`;

  try {
    const companionAudio = await findCompanionAudioPath(
      streamSessionId,
      sourceAbsolutePath
    );

    const args = [
      "-y",
      "-nostdin",
      "-loglevel",
      "error",
      "-err_detect",
      "ignore_err",
      "-i",
      sourceAbsolutePath,
    ];

    if (companionAudio) {
      const audioSeconds = await resolveReadableSeconds(companionAudio);
      const readableSeconds = Math.max(sourceSeconds, audioSeconds);
      // Bound mux length with the better estimate — still avoid a stale short probe.
      args.push("-i", companionAudio, "-t", String(Math.max(readableSeconds, 1)));
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
      // Copy all packets currently readable — no `-t` from a stale probe.
      args.push("-map", "0:v:0?", "-map", "0:a:0?", "-c", "copy");
    }

    args.push("-movflags", "+faststart", tempPath);

    await runCommand(getFfmpegPath(), args);
    // Never expose a half-written MP4. rename() makes the finalized moov atom
    // and media data visible together to browsers and render jobs.
    await rename(tempPath, outputPath);
    lastRemuxAt.set(streamSessionId, Date.now());
  } catch {
    // Growing file may be locked or incomplete — retry on next tick.
    lastRemuxAt.set(
      streamSessionId,
      Date.now() - interval + Math.min(interval, 5_000)
    );
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
