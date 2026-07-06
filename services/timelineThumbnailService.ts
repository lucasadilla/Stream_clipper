import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import { prisma } from "@/lib/db";
import { extractFastTimelineFrame, extractThumbnailStrip } from "@/lib/ffmpeg";
import {
  THUMB_INTERVAL_SECONDS,
  THUMB_LIVE_TAIL_PRIORITY_SECONDS,
  THUMB_SYNC_CHUNK_SECONDS,
  THUMB_SYNC_PASSES,
  THUMB_WIDTH_PX,
} from "@/lib/thumbnailConstants";
import { sanitizeDurationSeconds } from "@/lib/timelineBounds";
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

/** Legacy full-resolution thumbs (~200 KB); new strip thumbs are ~3 KB. */
const LEGACY_THUMB_MIN_BYTES = 30 * 1024;

const MAX_SPAN_SECONDS_PER_SYNC = THUMB_SYNC_CHUNK_SECONDS;

/** Strip extraction — one at a time per session. */
const activeExtractions = new Set<string>();

function thumbStartFromFilename(filename: string): number | null {
  const match = /^thumb_(\d+)\.jpg$/.exec(filename);
  if (!match) return null;
  const start = parseInt(match[1]!, 10);
  return Number.isNaN(start) ? null : start;
}

function alignBlock(timeSeconds: number): number {
  return (
    Math.floor(Math.max(0, timeSeconds) / THUMB_INTERVAL_SECONDS) *
    THUMB_INTERVAL_SECONDS
  );
}

async function listThumbStarts(framesDir: string): Promise<number[]> {
  if (!existsSync(framesDir)) return [];
  const files = await fs.readdir(framesDir);
  return files
    .map(thumbStartFromFilename)
    .filter((s): s is number => s !== null)
    .sort((a, b) => a - b);
}

async function removeLegacyThumbs(framesDir: string): Promise<void> {
  if (!existsSync(framesDir)) return;
  const files = await fs.readdir(framesDir);
  for (const f of files) {
    if (thumbStartFromFilename(f) === null) continue;
    const full = path.join(framesDir, f);
    try {
      const stat = await fs.stat(full);
      if (stat.size > LEGACY_THUMB_MIN_BYTES) await fs.unlink(full);
    } catch {
      // fine
    }
  }
}

/**
 * Grab 1–2 keyframes in ~1s each so the filmstrip isn't empty while the strip
 * pass runs. Never blocks on activeExtractions.
 */
export async function capturePriorityThumbs(
  streamSessionId: string,
  options?: { prioritizeTail?: boolean }
): Promise<void> {
  const sourceMedia = await prisma.sourceMedia.findFirst({
    where: { streamSessionId },
    orderBy: { createdAt: "desc" },
    select: { durationSeconds: true, filePath: true },
  });
  if (!sourceMedia?.filePath || !fileExists(sourceMedia.filePath)) return;

  const recorded = sanitizeDurationSeconds(sourceMedia.durationSeconds ?? 0);
  if (recorded < 1) return;

  const framesDir = getFramesDir(streamSessionId);
  await ensureDir(framesDir);
  const starts = new Set(await listThumbStarts(framesDir));
  const inputPath = resolveStoragePath(sourceMedia.filePath);
  const prioritizeTail = options?.prioritizeTail ?? false;

  const jobs: Array<{ blockStart: number; seekSeconds: number }> = [];

  if (!starts.has(0)) {
    jobs.push({ blockStart: 0, seekSeconds: 0 });
  }

  if (prioritizeTail && recorded >= THUMB_INTERVAL_SECONDS) {
    const tailBlock = alignBlock(recorded - 1);
    if (!starts.has(tailBlock)) {
      jobs.push({
        blockStart: tailBlock,
        seekSeconds: Math.max(0, recorded - 2),
      });
    }
  }

  await Promise.all(
    jobs.map(async ({ blockStart, seekSeconds }) => {
      const dest = path.join(framesDir, `thumb_${blockStart}.jpg`);
      try {
        await extractFastTimelineFrame(
          inputPath,
          dest,
          seekSeconds,
          THUMB_WIDTH_PX
        );
      } catch {
        // strip pass will cover this block
      }
    })
  );
}

async function extractMissingRange(
  inputPath: string,
  framesDir: string,
  fromSeconds: number,
  toSeconds: number
): Promise<void> {
  const span = toSeconds - fromSeconds;
  if (span < 2) return;

  const tmpDir = path.join(framesDir, `strip-tmp-${Date.now()}`);
  await ensureDir(tmpDir);

  try {
    await extractThumbnailStrip(
      inputPath,
      path.join(tmpDir, "t_%06d.jpg"),
      fromSeconds,
      span,
      THUMB_INTERVAL_SECONDS,
      THUMB_WIDTH_PX
    );

    const outputs = (await fs.readdir(tmpDir))
      .filter((f) => f.startsWith("t_"))
      .sort();

    for (let i = 0; i < outputs.length; i++) {
      const blockStart = fromSeconds + i * THUMB_INTERVAL_SECONDS;
      if (blockStart >= toSeconds) break;
      const dest = path.join(framesDir, `thumb_${blockStart}.jpg`);
      await fs.rename(path.join(tmpDir, outputs[i]!), dest).catch(() => {});
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

function findNextExtractionWindow(
  recordedInput: number,
  starts: Set<number>,
  prioritizeTail: boolean
): { from: number; to: number } | null {
  const recorded = sanitizeDurationSeconds(recordedInput);
  const blockCount = Math.min(
    10_000,
    Math.max(1, Math.ceil(recorded / THUMB_INTERVAL_SECONDS))
  );
  const missing: number[] = [];
  for (let i = 0; i < blockCount; i++) {
    const blockStart = i * THUMB_INTERVAL_SECONDS;
    if (!starts.has(blockStart)) missing.push(blockStart);
  }
  if (missing.length === 0) return null;

  const span = Math.min(MAX_SPAN_SECONDS_PER_SYNC, recorded);

  if (prioritizeTail && recorded > THUMB_LIVE_TAIL_PRIORITY_SECONDS) {
    const tailAnchor = missing[missing.length - 1]!;
    const from = Math.max(
      0,
      Math.floor(
        (tailAnchor - span + THUMB_INTERVAL_SECONDS) / THUMB_INTERVAL_SECONDS
      ) * THUMB_INTERVAL_SECONDS
    );
    return { from, to: Math.min(recorded, from + span) };
  }

  const from = missing[0]!;
  return { from, to: Math.min(recorded, from + span) };
}

export async function syncTimelineThumbnails(
  streamSessionId: string,
  options?: { prioritizeTail?: boolean }
): Promise<TimelineThumbnail[]> {
  const sourceMedia = await prisma.sourceMedia.findFirst({
    where: { streamSessionId },
    orderBy: { createdAt: "desc" },
  });

  if (!sourceMedia || !fileExists(sourceMedia.filePath)) {
    return [];
  }

  const recorded = sanitizeDurationSeconds(sourceMedia.durationSeconds ?? 0);
  if (recorded < 2) return [];

  const framesDir = getFramesDir(streamSessionId);
  await ensureDir(framesDir);
  const inputPath = resolveStoragePath(sourceMedia.filePath);
  const prioritizeTail = options?.prioritizeTail ?? false;

  if (!activeExtractions.has(streamSessionId)) {
    activeExtractions.add(streamSessionId);
    try {
      await removeLegacyThumbs(framesDir);

      for (let pass = 0; pass < THUMB_SYNC_PASSES; pass++) {
        const starts = new Set(await listThumbStarts(framesDir));
        const window = findNextExtractionWindow(
          recorded,
          starts,
          prioritizeTail
        );
        if (!window || window.to - window.from < 2) break;
        await extractMissingRange(
          inputPath,
          framesDir,
          window.from,
          window.to
        );
      }
    } finally {
      activeExtractions.delete(streamSessionId);
    }
  }

  return listThumbnailsFromDisk(streamSessionId, framesDir);
}

async function listThumbnailsFromDisk(
  streamSessionId: string,
  framesDir: string
): Promise<TimelineThumbnail[]> {
  const starts = await listThumbStarts(framesDir);
  return starts.map((start) => {
    const relative = toRelativeStoragePath(
      path.join(framesDir, `thumb_${start}.jpg`)
    );
    return {
      startTimeSeconds: start,
      endTimeSeconds: start + THUMB_INTERVAL_SECONDS,
      url: `/api/storage/${relative.replace(/\\/g, "/")}?inline=1`,
    };
  });
}

export async function getTimelineThumbnails(
  streamSessionId: string,
  options?: { isLive?: boolean }
): Promise<TimelineThumbnail[]> {
  const framesDir = getFramesDir(streamSessionId);
  const existing = await listThumbnailsFromDisk(streamSessionId, framesDir);

  const sourceMedia = await prisma.sourceMedia.findFirst({
    where: { streamSessionId },
    orderBy: { createdAt: "desc" },
    select: { durationSeconds: true, filePath: true },
  });
  const recorded = sourceMedia?.durationSeconds ?? 0;
  const lastCovered =
    existing.length > 0 ? existing[existing.length - 1]!.endTimeSeconds : 0;

  let hasLegacyThumbs = false;
  if (existing.length > 0) {
    try {
      const probe = path.join(
        framesDir,
        `thumb_${existing[0]!.startTimeSeconds}.jpg`
      );
      hasLegacyThumbs = (await fs.stat(probe)).size > LEGACY_THUMB_MIN_BYTES;
    } catch {
      // ignore
    }
  }

  const needsMore =
    recorded - lastCovered >= THUMB_INTERVAL_SECONDS || hasLegacyThumbs;

  if (needsMore && sourceMedia && fileExists(sourceMedia.filePath)) {
    const prioritizeTail = options?.isLive ?? false;
    void capturePriorityThumbs(streamSessionId, { prioritizeTail }).catch(
      () => {}
    );
    if (!activeExtractions.has(streamSessionId)) {
      void syncTimelineThumbnails(streamSessionId, { prioritizeTail }).catch(
        () => {}
      );
    }
  }

  return existing;
}
