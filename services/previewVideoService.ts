import path from "path";
import { existsSync } from "fs";
import { stat } from "fs/promises";
import { getFfmpegPath, runCommand } from "@/lib/ffmpeg";
import {
  getUploadDir,
  toRelativeStoragePath,
  resolveStoragePath,
  fileExists,
} from "@/lib/storage";

const PREVIEW_FILENAME = "preview.mp4";
const MIN_PREVIEW_BYTES = 48 * 1024;
const REMUX_INTERVAL_MS = 12_000;

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
    return s.size >= MIN_PREVIEW_BYTES;
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
 * Remux the growing capture (usually .mkv) into browser-playable MP4 for preview.
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

  try {
    await runCommand(getFfmpegPath(), [
      "-y",
      "-nostdin",
      "-loglevel",
      "error",
      "-i",
      sourceAbsolutePath,
      "-map",
      "0:v:0?",
      "-map",
      "0:a:0?",
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      outputPath,
    ]);
    lastRemuxAt.set(streamSessionId, Date.now());
  } catch {
    // Growing file may be locked or incomplete — retry on next tick.
  } finally {
    remuxInFlight.delete(streamSessionId);
  }
}

export function buildPreviewVideoUrl(relativePath: string | null): string | null {
  if (!relativePath || !fileExists(relativePath)) return null;
  return `/api/storage/${relativePath.replace(/\\/g, "/")}?inline=1`;
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
