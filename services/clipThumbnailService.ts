import path from "path";
import { existsSync } from "fs";
import {
  extractFastTimelineFrame,
  extractSoloTimelineFrame,
} from "@/lib/ffmpeg";
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

const activeThumbnailJobs = new Map<string, Promise<string | null>>();

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
  clipSuggestionId: string,
  cacheBust?: number
): string | null {
  const relative = clipThumbRelativePath(streamSessionId, clipSuggestionId);
  if (!fileExists(relative)) return null;
  const base = `/api/storage/${relative.replace(/\\/g, "/")}?inline=1`;
  return cacheBust ? `${base}&v=${cacheBust}` : base;
}

/** Stable client URL — hits an endpoint that generates the frame if missing. */
export function clipThumbnailApiUrl(clipSuggestionId: string): string {
  return `/api/clips/${clipSuggestionId}/thumbnail?inline=1`;
}

async function resolveThumbInput(
  streamSessionId: string
): Promise<string | null> {
  const previewPath = getPreviewMp4Path(streamSessionId);
  if (existsSync(previewPath)) return previewPath;

  const sourceMedia = await findLocalSourceMedia(streamSessionId);
  if (sourceMedia?.filePath && fileExists(sourceMedia.filePath)) {
    return resolveStoragePath(sourceMedia.filePath);
  }
  return null;
}

export async function ensureClipSuggestionThumbnail(
  streamSessionId: string,
  clipSuggestionId: string
): Promise<string | null> {
  const key = `${streamSessionId}:${clipSuggestionId}`;
  const active = activeThumbnailJobs.get(key);
  if (active) return active;

  let job: Promise<string | null>;
  job = generateClipSuggestionThumbnail(
    streamSessionId,
    clipSuggestionId
  ).finally(() => {
    if (activeThumbnailJobs.get(key) === job) {
      activeThumbnailJobs.delete(key);
    }
  });
  activeThumbnailJobs.set(key, job);
  return job;
}

async function generateClipSuggestionThumbnail(
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
    return clipThumbPublicUrl(streamSessionId, clipSuggestionId, Date.now());
  }

  const inputPath = await resolveThumbInput(streamSessionId);
  if (!inputPath) return null;

  const mid =
    (clip.startTimeSeconds + clip.endTimeSeconds) / 2 ||
    clip.startTimeSeconds + 1;
  // Prefer a beat slightly into the clip — mid is often a reaction face.
  const seekTimes = [
    mid,
    clip.startTimeSeconds + Math.min(4, (clip.endTimeSeconds - clip.startTimeSeconds) * 0.35),
    clip.startTimeSeconds + 1,
  ];

  for (const t of seekTimes) {
    try {
      await extractSoloTimelineFrame(inputPath, dest, Math.max(0, t), 480, 3);
      if (existsSync(dest)) {
        return clipThumbPublicUrl(streamSessionId, clipSuggestionId, Date.now());
      }
    } catch {
      // try next
    }
    try {
      await extractFastTimelineFrame(inputPath, dest, Math.max(0, t), 480, 3);
      if (existsSync(dest)) {
        return clipThumbPublicUrl(streamSessionId, clipSuggestionId, Date.now());
      }
    } catch {
      // try next seek
    }
  }

  return null;
}

export async function ensureClipSuggestionThumbnails(
  streamSessionId: string,
  clipIds: string[]
): Promise<void> {
  // Parallelize a bit — sequential was slow and clients timed out waiting.
  const ids = clipIds.slice(0, 20);
  const concurrency = 3;
  for (let i = 0; i < ids.length; i += concurrency) {
    const wave = ids.slice(i, i + concurrency);
    await Promise.all(
      wave.map((id) =>
        ensureClipSuggestionThumbnail(streamSessionId, id).catch(() => null)
      )
    );
  }
}
