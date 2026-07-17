import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import { extractSoloTimelineFrame, extractThumbnailStrip } from "@/lib/ffmpeg";
import {
  THUMB_LIVE_TAIL_PRIORITY_SECONDS,
  THUMB_MAX_FRAME_COUNT,
  THUMB_SOLO_QUALITY,
  THUMB_SOLO_WIDTH_PX,
  THUMB_SYNC_PASSES,
  THUMB_WIDTH_PX,
  expectedThumbCountForDuration,
  sparseThumbStarts,
  thumbIntervalForDuration,
} from "@/lib/thumbnailConstants";
import { sanitizeDurationSeconds } from "@/lib/timelineBounds";
import {
  getFramesDir,
  ensureDir,
  resolveStoragePath,
  fileExists,
  toRelativeStoragePath,
} from "@/lib/storage";
import { findLocalSourceMedia } from "@/services/sourceMediaRepairService";
import { prisma } from "@/lib/db";

export interface TimelineThumbnail {
  startTimeSeconds: number;
  endTimeSeconds: number;
  url: string;
}

/** Legacy full-resolution thumbs (~200 KB); new strip thumbs are ~3 KB. */
const LEGACY_THUMB_MIN_BYTES = 30 * 1024;

/** Strip extraction — one at a time per session. */
const activeExtractions = new Set<string>();

function thumbStartFromFilename(filename: string): number | null {
  const match = /^thumb_(\d+)\.jpg$/.exec(filename);
  if (!match) return null;
  const start = parseInt(match[1]!, 10);
  return Number.isNaN(start) ? null : start;
}

function alignBlock(timeSeconds: number, interval: number): number {
  const step = Math.max(1, interval);
  return Math.floor(Math.max(0, timeSeconds) / step) * step;
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
  const sourceMedia = await findLocalSourceMedia(streamSessionId);
  if (!sourceMedia?.filePath || !fileExists(sourceMedia.filePath)) return;

  const recorded = sanitizeDurationSeconds(sourceMedia.durationSeconds ?? 0);
  if (recorded < 1) return;

  const framesDir = getFramesDir(streamSessionId);
  await ensureDir(framesDir);
  const starts = new Set(await listThumbStarts(framesDir));
  const inputPath = resolveStoragePath(sourceMedia.filePath);
  const prioritizeTail = options?.prioritizeTail ?? false;
  const interval = thumbIntervalForDuration(recorded);

  const jobs: Array<{ blockStart: number; seekSeconds: number }> = [];

  if (!starts.has(0)) {
    jobs.push({ blockStart: 0, seekSeconds: 0 });
  }

  if (prioritizeTail && recorded >= interval) {
    const tailBlock = alignBlock(recorded - 1, interval);
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
        await extractSoloTimelineFrame(
          inputPath,
          dest,
          seekSeconds,
          THUMB_SOLO_WIDTH_PX,
          THUMB_SOLO_QUALITY
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
  expectedBlocks: number[],
  interval: number
): Promise<void> {
  if (expectedBlocks.length === 0) return;

  const isArithmetic = expectedBlocks.every((start, index) => {
    if (index === 0) return true;
    return start - expectedBlocks[index - 1]! === interval;
  });

  const useStrip = isArithmetic && expectedBlocks.length > 4;
  if (useStrip) {
    const fromSeconds = expectedBlocks[0]!;
    const lastStart = expectedBlocks[expectedBlocks.length - 1]!;
    const span = Math.max(interval, lastStart - fromSeconds + interval);
    if (span >= 2) {
      const tmpDir = path.join(framesDir, `strip-tmp-${Date.now()}`);
      await ensureDir(tmpDir);
      try {
        await extractThumbnailStrip(
          inputPath,
          path.join(tmpDir, "t_%06d.jpg"),
          fromSeconds,
          span,
          interval,
          THUMB_WIDTH_PX
        );

        const outputs = (await fs.readdir(tmpDir))
          .filter((f) => f.startsWith("t_"))
          .sort();

        // Only trust strip→block mapping when counts match. Keyframe-only extracts
        // often return fewer images; renaming by index would stamp wrong times.
        if (outputs.length === expectedBlocks.length) {
          for (let i = 0; i < outputs.length; i++) {
            const blockStart = expectedBlocks[i]!;
            const dest = path.join(framesDir, `thumb_${blockStart}.jpg`);
            const src = path.join(tmpDir, outputs[i]!);
            try {
              const stat = await fs.stat(src);
              if (stat.size < 400) continue;
              await fs.rename(src, dest).catch(() => {});
            } catch {
              // gap-fill below
            }
          }
        }
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  // Sparse mode: only fill a few gaps — UI stretches neighbors.
  const MAX_GAP_FILL_PER_PASS = useStrip ? 4 : Math.min(12, expectedBlocks.length);
  const have = new Set(await listThumbStarts(framesDir));
  let filled = 0;
  for (const blockStart of expectedBlocks) {
    if (filled >= MAX_GAP_FILL_PER_PASS) break;
    if (have.has(blockStart)) continue;
    const dest = path.join(framesDir, `thumb_${blockStart}.jpg`);
    try {
      await extractSoloTimelineFrame(
        inputPath,
        dest,
        blockStart,
        THUMB_SOLO_WIDTH_PX,
        THUMB_SOLO_QUALITY
      );
      const stat = await fs.stat(dest);
      if (stat.size < 400) await fs.unlink(dest).catch(() => {});
      else filled += 1;
    } catch {
      // leave gap; UI stretches neighboring thumbs
    }
  }
}

function findMissingSparseBlocks(
  recordedInput: number,
  starts: Set<number>,
  prioritizeTail: boolean
): number[] {
  const recorded = sanitizeDurationSeconds(recordedInput);
  const expected = sparseThumbStarts(recorded);
  const missing = expected.filter((start) => !starts.has(start));
  if (missing.length === 0) return [];

  if (prioritizeTail && recorded > THUMB_LIVE_TAIL_PRIORITY_SECONDS) {
    // Pull the last missing blocks first so the live edge paints sooner.
    return missing.slice(-Math.min(missing.length, THUMB_MAX_FRAME_COUNT));
  }
  return missing.slice(0, THUMB_MAX_FRAME_COUNT);
}

function isMissingMediaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /No such file or directory|ENOENT/i.test(message);
}

async function resolveThumbnailInputPath(
  streamSessionId: string
): Promise<{ inputPath: string; recorded: number } | null> {
  const sourceMedia = await findLocalSourceMedia(streamSessionId);
  if (!sourceMedia?.filePath || !fileExists(sourceMedia.filePath)) {
    return null;
  }
  const recorded = sanitizeDurationSeconds(sourceMedia.durationSeconds ?? 0);
  if (recorded < 2) return null;
  return {
    inputPath: resolveStoragePath(sourceMedia.filePath),
    recorded,
  };
}

export async function syncTimelineThumbnails(
  streamSessionId: string,
  options?: { prioritizeTail?: boolean }
): Promise<TimelineThumbnail[]> {
  let resolved = await resolveThumbnailInputPath(streamSessionId);
  if (!resolved) return [];

  const framesDir = getFramesDir(streamSessionId);
  await ensureDir(framesDir);
  const prioritizeTail = options?.prioritizeTail ?? false;

  if (!activeExtractions.has(streamSessionId)) {
    activeExtractions.add(streamSessionId);
    try {
      await removeLegacyThumbs(framesDir);

      for (let pass = 0; pass < THUMB_SYNC_PASSES; pass++) {
        // Re-resolve each pass — live captures can remux away source.fNNN.*
        // while a strip is still running.
        resolved = await resolveThumbnailInputPath(streamSessionId);
        if (!resolved) break;

        const starts = new Set(await listThumbStarts(framesDir));
        const missing = findMissingSparseBlocks(
          resolved.recorded,
          starts,
          prioritizeTail
        );
        if (missing.length === 0) break;

        const interval = thumbIntervalForDuration(resolved.recorded);
        try {
          await extractMissingRange(
            resolved.inputPath,
            framesDir,
            missing,
            interval
          );
        } catch (error) {
          if (isMissingMediaError(error)) {
            const retry = await resolveThumbnailInputPath(streamSessionId);
            if (!retry || retry.inputPath === resolved.inputPath) break;
            await extractMissingRange(
              retry.inputPath,
              framesDir,
              missing,
              thumbIntervalForDuration(retry.recorded)
            );
            continue;
          }
          throw error;
        }
      }
    } finally {
      activeExtractions.delete(streamSessionId);
    }
  }

  return listThumbnailsFromDisk(streamSessionId, framesDir, resolved?.recorded);
}

async function listThumbnailsFromDisk(
  streamSessionId: string,
  framesDir: string,
  recordedSeconds?: number
): Promise<TimelineThumbnail[]> {
  const starts = await listThumbStarts(framesDir);
  if (starts.length === 0) return [];

  const recorded =
    recordedSeconds != null && recordedSeconds > 0
      ? recordedSeconds
      : starts[starts.length - 1]! +
        thumbIntervalForDuration(starts[starts.length - 1]! + 1);

  return starts.map((start, index) => {
    const next = starts[index + 1];
    const endTimeSeconds =
      next != null ? next : Math.max(start + 1, recorded);
    const relative = toRelativeStoragePath(
      path.join(framesDir, `thumb_${start}.jpg`)
    );
    return {
      startTimeSeconds: start,
      endTimeSeconds,
      url: `/api/storage/${relative.replace(/\\/g, "/")}?inline=1`,
    };
  });
}

export async function getTimelineThumbnails(
  streamSessionId: string,
  options?: { isLive?: boolean }
): Promise<TimelineThumbnail[]> {
  const session = await prisma.streamSession.findUnique({
    where: { id: streamSessionId },
    select: { mode: true },
  });
  if (session?.mode === "agent") {
    return [];
  }

  const framesDir = getFramesDir(streamSessionId);
  const sourceMedia = await findLocalSourceMedia(streamSessionId);
  const recorded = sanitizeDurationSeconds(sourceMedia?.durationSeconds ?? 0);
  const existing = await listThumbnailsFromDisk(
    streamSessionId,
    framesDir,
    recorded
  );

  const expected = expectedThumbCountForDuration(recorded);
  const coverage =
    expected > 0 ? existing.length / expected : existing.length > 0 ? 1 : 0;

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

  const needsMore = (expected > 0 && coverage < 0.9) || hasLegacyThumbs;

  if (needsMore && sourceMedia && fileExists(sourceMedia.filePath)) {
    const prioritizeTail = options?.isLive ?? false;
    // Hot path: return disk list immediately. Kick ffmpeg in the background so
    // timeline polls never block on encode (critical for multi-hour live).
    if (!activeExtractions.has(streamSessionId)) {
      void (async () => {
        await capturePriorityThumbs(streamSessionId, { prioritizeTail }).catch(
          (error) =>
            console.warn("[thumbnails] priority capture failed:", error)
        );
        await syncTimelineThumbnails(streamSessionId, { prioritizeTail }).catch(
          (error) => {
            if (isMissingMediaError(error)) {
              console.warn(
                "[thumbnails] source media disappeared mid-extract; will retry on next poll"
              );
              return;
            }
            console.error("[thumbnails] strip extraction failed:", error);
          }
        );
      })();
    }
  }

  return existing;
}
