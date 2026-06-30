import path from "path";
import { existsSync } from "fs";
import { prisma } from "@/lib/db";
import { extractFrameAt } from "@/lib/ffmpeg";
import { LIVE_SEGMENT_SECONDS } from "@/lib/timelineConstants";
import {
  getFramesDir,
  ensureDir,
  resolveStoragePath,
  fileExists,
  toRelativeStoragePath,
} from "@/lib/storage";

export interface TimelineThumbnail {
  startTimeSeconds: number;
  endTimeSeconds: number;
  url: string;
}

export async function syncTimelineThumbnails(
  streamSessionId: string
): Promise<TimelineThumbnail[]> {
  const sourceMedia = await prisma.sourceMedia.findFirst({
    where: { streamSessionId },
    orderBy: { createdAt: "desc" },
  });

  if (!sourceMedia || !fileExists(sourceMedia.filePath)) {
    return [];
  }

  const recorded = sourceMedia.durationSeconds ?? 0;
  if (recorded < 2) return [];

  const framesDir = getFramesDir(streamSessionId);
  await ensureDir(framesDir);

  const inputPath = resolveStoragePath(sourceMedia.filePath);
  const blockCount = Math.max(1, Math.ceil(recorded / LIVE_SEGMENT_SECONDS));
  const thumbs: TimelineThumbnail[] = [];

  for (let i = 0; i < blockCount; i++) {
    const start = i * LIVE_SEGMENT_SECONDS;
    const end = Math.min(start + LIVE_SEGMENT_SECONDS, recorded);
    const thumbFile = `thumb_${start}.jpg`;
    const absoluteThumb = path.join(framesDir, thumbFile);

    if (!existsSync(absoluteThumb)) {
      const sampleTime = start + Math.min(LIVE_SEGMENT_SECONDS / 2, end - start - 0.5);
      try {
        await extractFrameAt(inputPath, absoluteThumb, Math.max(0, sampleTime));
      } catch {
        continue;
      }
    }

    const relative = toRelativeStoragePath(absoluteThumb);
    thumbs.push({
      startTimeSeconds: start,
      endTimeSeconds: end,
      url: `/api/storage/${relative.replace(/\\/g, "/")}?inline=1`,
    });
  }

  return thumbs;
}

export async function getTimelineThumbnails(
  streamSessionId: string
): Promise<TimelineThumbnail[]> {
  const framesDir = getFramesDir(streamSessionId);
  if (!existsSync(framesDir)) {
    return syncTimelineThumbnails(streamSessionId);
  }

  const { readdir } = await import("fs/promises");
  const files = (await readdir(framesDir)).filter((f) => f.startsWith("thumb_"));
  if (files.length === 0) {
    return syncTimelineThumbnails(streamSessionId);
  }

  return files
    .map((f) => {
      const start = parseInt(f.replace("thumb_", "").replace(".jpg", ""), 10);
      if (Number.isNaN(start)) return null;
      const relative = toRelativeStoragePath(path.join(framesDir, f));
      return {
        startTimeSeconds: start,
        endTimeSeconds: start + LIVE_SEGMENT_SECONDS,
        url: `/api/storage/${relative.replace(/\\/g, "/")}?inline=1`,
      };
    })
    .filter((t): t is TimelineThumbnail => t !== null)
    .sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);
}
