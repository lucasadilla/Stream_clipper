import path from "path";
import { existsSync } from "fs";
import { extractFastTimelineFrame } from "@/lib/ffmpeg";
import {
  ensureDir,
  getFramesDir,
  resolveStoragePath,
  fileExists,
  toRelativeStoragePath,
} from "@/lib/storage";
import { findLocalSourceMedia } from "@/services/sourceMediaRepairService";
import { prisma } from "@/lib/db";
import { getPreviewMp4Path } from "@/services/previewVideoService";

export function clipThumbRelativePath(
  streamSessionId: string,
  clipSuggestionId: string
): string {
  return toRelativeStoragePath(
    path.join(getFramesDir(streamSessionId), `clip_${clipSuggestionId}.jpg`)
  );
}

export function clipThumbPublicUrl(
  streamSessionId: string,
  clipSuggestionId: string
): string | null {
  const relative = clipThumbRelativePath(streamSessionId, clipSuggestionId);
  return fileExists(relative)
    ? `/api/storage/${relative.replace(/\\/g, "/")}?inline=1`
    : null;
}

export async function ensureClipSuggestionThumbnail(
  streamSessionId: string,
  clipSuggestionId: string
): Promise<string | null> {
  const clip = await prisma.clipSuggestion.findFirst({
    where: { id: clipSuggestionId, streamSessionId },
  });
  if (!clip) return null;

  const framesDir = getFramesDir(streamSessionId);
  await ensureDir(framesDir);
  const dest = path.join(framesDir, `clip_${clipSuggestionId}.jpg`);
  if (existsSync(dest)) {
    return clipThumbPublicUrl(streamSessionId, clipSuggestionId);
  }

  const sourceMedia = await findLocalSourceMedia(streamSessionId);
  const previewPath = getPreviewMp4Path(streamSessionId);
  let inputPath: string | null = null;
  if (existsSync(previewPath)) {
    inputPath = previewPath;
  } else if (sourceMedia?.filePath && fileExists(sourceMedia.filePath)) {
    inputPath = resolveStoragePath(sourceMedia.filePath);
  }
  if (!inputPath) return null;

  const mid =
    (clip.startTimeSeconds + clip.endTimeSeconds) / 2 ||
    clip.startTimeSeconds + 1;

  try {
    await extractFastTimelineFrame(inputPath, dest, mid, 320, 4);
    return clipThumbPublicUrl(streamSessionId, clipSuggestionId);
  } catch {
    return null;
  }
}

export async function ensureClipSuggestionThumbnails(
  streamSessionId: string,
  clipIds: string[]
): Promise<void> {
  for (const id of clipIds.slice(0, 15)) {
    await ensureClipSuggestionThumbnail(streamSessionId, id).catch(() => null);
  }
}
