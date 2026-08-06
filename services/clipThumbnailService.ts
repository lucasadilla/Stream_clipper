import path from "path";
import { existsSync, statSync } from "fs";
import { unlink } from "fs/promises";
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
import { ensureClipSourceForRender } from "@/services/clipSourceService";
import { prisma } from "@/lib/db";

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

function validThumbnail(filePath: string): boolean {
  if (!existsSync(filePath)) return false;
  try {
    return statSync(filePath).size >= 1_024;
  } catch {
    return false;
  }
}

async function resolveThumbInput(
  streamSessionId: string,
  startTimeSeconds: number,
  endTimeSeconds: number
): Promise<{ inputPath: string; seekOffsetSeconds: number } | null> {
  const clipSource = await ensureClipSourceForRender(
    streamSessionId,
    startTimeSeconds,
    endTimeSeconds
  );
  const sourceMedia = await prisma.sourceMedia.findUnique({
    where: { id: clipSource.sourceMediaId },
    select: { filePath: true },
  });
  if (!sourceMedia?.filePath || !fileExists(sourceMedia.filePath)) return null;

  return {
    inputPath: resolveStoragePath(sourceMedia.filePath),
    seekOffsetSeconds: clipSource.renderStart - startTimeSeconds,
  };
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
  if (validThumbnail(dest)) {
    return clipThumbPublicUrl(streamSessionId, clipSuggestionId, Date.now());
  }
  await unlink(dest).catch(() => {});

  const input = await resolveThumbInput(
    streamSessionId,
    clip.startTimeSeconds,
    clip.endTimeSeconds
  );
  if (!input) return null;

  const mid = (clip.startTimeSeconds + clip.endTimeSeconds) / 2;
  const raw = clip.rawAiJson;
  const storedFocus =
    raw &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    typeof raw.focusTimeSeconds === "number" &&
    Number.isFinite(raw.focusTimeSeconds) &&
    raw.focusTimeSeconds >= clip.startTimeSeconds &&
    raw.focusTimeSeconds <= clip.endTimeSeconds
      ? raw.focusTimeSeconds
      : null;
  // Prefer a beat slightly into the clip — mid is often a reaction face.
  const seekTimes = [
    storedFocus,
    mid || clip.startTimeSeconds + 1,
    clip.startTimeSeconds +
      Math.min(4, (clip.endTimeSeconds - clip.startTimeSeconds) * 0.35),
    clip.startTimeSeconds + 1,
  ].filter(
    (value, index, values): value is number =>
      value != null && values.indexOf(value) === index
  );

  for (const t of seekTimes) {
    const seekTime = Math.max(0, t + input.seekOffsetSeconds);
    try {
      await extractSoloTimelineFrame(input.inputPath, dest, seekTime, 480, 3);
      if (validThumbnail(dest)) {
        return clipThumbPublicUrl(streamSessionId, clipSuggestionId, Date.now());
      }
    } catch {
      // try next
    }
    await unlink(dest).catch(() => {});
    try {
      await extractFastTimelineFrame(input.inputPath, dest, seekTime, 480, 3);
      if (validThumbnail(dest)) {
        return clipThumbPublicUrl(streamSessionId, clipSuggestionId, Date.now());
      }
    } catch {
      // try next seek
    }
    await unlink(dest).catch(() => {});
  }

  return null;
}

export async function ensureClipSuggestionThumbnails(
  streamSessionId: string,
  clipIds: string[]
): Promise<void> {
  // Parallelize a bit — sequential was slow and clients timed out waiting.
  const ids = clipIds.slice(0, 20);
  const concurrency = 2;
  for (let i = 0; i < ids.length; i += concurrency) {
    const wave = ids.slice(i, i + concurrency);
    await Promise.all(
      wave.map((id) =>
        ensureClipSuggestionThumbnail(streamSessionId, id).catch(() => null)
      )
    );
  }
}
