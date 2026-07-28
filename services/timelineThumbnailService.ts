import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import {
  extractFastTimelineFrame,
  extractSoloTimelineFrame,
  extractThumbnailStrip,
  probeMediaDurationBestEffort,
} from "@/lib/ffmpeg";
import {
  THUMB_LIVE_FIRST_CHUNK_SECONDS,
  THUMB_LIVE_STRIP_CHUNK_SECONDS,
  THUMB_LIVE_TAIL_PRIORITY_SECONDS,
  THUMB_MAX_FRAME_COUNT,
  THUMB_PARALLEL_BOOTSTRAP_MAX,
  THUMB_SOLO_QUALITY,
  THUMB_SOLO_WIDTH_PX,
  THUMB_SYNC_PASSES,
  THUMB_SYNC_PASSES_LIVE,
  THUMB_WIDTH_PX,
  expectedThumbCountForDuration,
  limitThumbBlocksToChunk,
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
import { getPreviewMp4Path } from "@/services/previewVideoService";

export interface TimelineThumbnail {
  startTimeSeconds: number;
  endTimeSeconds: number;
  url: string;
}

/** Legacy full-resolution thumbs (~200 KB); new strip thumbs are ~3 KB. */
const LEGACY_THUMB_MIN_BYTES = 30 * 1024;

/** Strip extraction — one at a time per session. */
const activeExtractions = new Set<string>();

/** Skip legacy cleanup after the first clean pass for a session. */
const legacyCleaned = new Set<string>();

/** Cache preview-vs-source choice briefly (probe is relatively expensive). */
const seekableInputCache = new Map<
  string,
  { path: string; expiresAt: number }
>();

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
 * Prefer seekable preview.mp4 when it covers enough of the capture — seeking
 * incomplete Kick source.f* / growing MKV for filmstrip is much slower.
 */
async function resolveSeekableThumbInput(
  streamSessionId: string,
  sourceAbsolutePath: string,
  recordedSeconds: number
): Promise<string> {
  const cached = seekableInputCache.get(streamSessionId);
  if (cached && cached.expiresAt > Date.now()) {
    if (existsSync(cached.path)) return cached.path;
  }

  const previewPath = getPreviewMp4Path(streamSessionId);
  let chosen = sourceAbsolutePath;
  if (existsSync(previewPath)) {
    try {
      const previewSeconds = await probeMediaDurationBestEffort(previewPath);
      const useful =
        previewSeconds >= Math.min(recordedSeconds * 0.8, 60) ||
        previewSeconds >=
          Math.min(recordedSeconds, THUMB_LIVE_FIRST_CHUNK_SECONDS);
      if (useful && previewSeconds >= 5) chosen = previewPath;
    } catch {
      // fall through
    }
  }

  seekableInputCache.set(streamSessionId, {
    path: chosen,
    expiresAt: Date.now() + 8_000,
  });
  return chosen;
}

async function writeFastThumb(
  inputPath: string,
  dest: string,
  seekSeconds: number
): Promise<boolean> {
  try {
    await extractFastTimelineFrame(
      inputPath,
      dest,
      seekSeconds,
      THUMB_WIDTH_PX,
      9
    );
    const stat = await fs.stat(dest);
    if (stat.size < 400) {
      await fs.unlink(dest).catch(() => {});
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Parallel keyframe grabs — same 96px / q=9 look as the strip path, much
 * faster for the first handful of blocks.
 */
async function extractBlocksParallelFast(
  inputPath: string,
  framesDir: string,
  blocks: number[]
): Promise<void> {
  const concurrency = 4;
  for (let i = 0; i < blocks.length; i += concurrency) {
    const batch = blocks.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (blockStart) => {
        const dest = path.join(framesDir, `thumb_${blockStart}.jpg`);
        if (existsSync(dest)) return;
        await writeFastThumb(inputPath, dest, blockStart);
      })
    );
  }
}

/**
 * Grab 1–2 keyframes in ~1s each so the filmstrip isn't empty while the strip
 * pass runs. Never blocks on activeExtractions.
 */
export async function capturePriorityThumbs(
  streamSessionId: string,
  options?: { prioritizeTail?: boolean; prioritizeHead?: boolean }
): Promise<void> {
  const sourceMedia = await findLocalSourceMedia(streamSessionId);
  if (!sourceMedia?.filePath || !fileExists(sourceMedia.filePath)) return;

  const recorded = sanitizeDurationSeconds(sourceMedia.durationSeconds ?? 0);
  if (recorded < 1) return;

  const framesDir = getFramesDir(streamSessionId);
  await ensureDir(framesDir);
  const starts = new Set(await listThumbStarts(framesDir));
  const sourcePath = resolveStoragePath(sourceMedia.filePath);
  const inputPath = await resolveSeekableThumbInput(
    streamSessionId,
    sourcePath,
    recorded
  );
  const prioritizeTail = options?.prioritizeTail ?? false;
  const prioritizeHead = options?.prioritizeHead ?? true;
  const interval = thumbIntervalForDuration(recorded);

  const jobs: number[] = [];

  if (prioritizeHead && !starts.has(0)) jobs.push(0);

  if (prioritizeHead && recorded >= interval) {
    const mid = alignBlock(Math.min(recorded / 2, 60), interval);
    if (mid > 0 && !starts.has(mid)) jobs.push(mid);
    const quarter = alignBlock(Math.min(recorded / 4, 30), interval);
    if (quarter > 0 && quarter !== mid && !starts.has(quarter)) {
      jobs.push(quarter);
    }
  }

  if (prioritizeTail && recorded >= interval) {
    const tailBlock = alignBlock(recorded - 1, interval);
    if (!starts.has(tailBlock)) jobs.push(tailBlock);
  }

  await extractBlocksParallelFast(inputPath, framesDir, jobs);
}

async function extractMissingRange(
  inputPath: string,
  framesDir: string,
  expectedBlocks: number[],
  interval: number,
  options?: { fastGapFill?: boolean }
): Promise<void> {
  if (expectedBlocks.length === 0) return;

  // Small sets: parallel keyframes (same quality as strip) beat a long strip.
  if (expectedBlocks.length <= THUMB_PARALLEL_BOOTSTRAP_MAX) {
    await extractBlocksParallelFast(inputPath, framesDir, expectedBlocks);
    return;
  }

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

        // Keep partial strips — discarding them forced slow solo gap-fills.
        const mapCount = Math.min(outputs.length, expectedBlocks.length);
        const acceptPartial =
          outputs.length === expectedBlocks.length ||
          outputs.length >= Math.ceil(expectedBlocks.length * 0.4);
        if (mapCount > 0 && acceptPartial) {
          for (let i = 0; i < mapCount; i++) {
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

  const have = new Set(await listThumbStarts(framesDir));
  const stillMissing = expectedBlocks.filter((b) => !have.has(b));
  if (stillMissing.length === 0) return;

  const MAX_GAP_FILL_PER_PASS = useStrip
    ? 4
    : Math.min(options?.fastGapFill ? 8 : 12, stillMissing.length);
  const toFill = stillMissing.slice(0, MAX_GAP_FILL_PER_PASS);

  if (options?.fastGapFill) {
    await extractBlocksParallelFast(inputPath, framesDir, toFill);
    return;
  }

  // VOD polish: keep the sharper solo stills for remaining gaps.
  for (const blockStart of toFill) {
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
    } catch {
      // leave gap; UI stretches neighboring thumbs
    }
  }
}

function findMissingSparseBlocks(
  recordedInput: number,
  starts: Set<number>,
  options?: { prioritizeTail?: boolean; prioritizeHead?: boolean }
): number[] {
  const recorded = sanitizeDurationSeconds(recordedInput);
  const expected = sparseThumbStarts(recorded);
  const missing = expected.filter((start) => !starts.has(start));
  if (missing.length === 0) return [];

  const prioritizeHead = options?.prioritizeHead !== false;
  const prioritizeTail = options?.prioritizeTail ?? false;

  if (prioritizeHead || !prioritizeTail) {
    return missing.slice(0, THUMB_MAX_FRAME_COUNT);
  }

  if (prioritizeTail && recorded > THUMB_LIVE_TAIL_PRIORITY_SECONDS) {
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
  const sourcePath = resolveStoragePath(sourceMedia.filePath);
  const inputPath = await resolveSeekableThumbInput(
    streamSessionId,
    sourcePath,
    recorded
  );
  return { inputPath, recorded };
}

export async function syncTimelineThumbnails(
  streamSessionId: string,
  options?: {
    prioritizeTail?: boolean;
    prioritizeHead?: boolean;
    isLive?: boolean;
  }
): Promise<TimelineThumbnail[]> {
  let resolved = await resolveThumbnailInputPath(streamSessionId);
  if (!resolved) return [];

  const framesDir = getFramesDir(streamSessionId);
  await ensureDir(framesDir);
  const prioritizeTail = options?.prioritizeTail ?? false;
  const prioritizeHead = options?.prioritizeHead ?? true;
  const isLive = options?.isLive ?? false;
  const passes = isLive ? THUMB_SYNC_PASSES_LIVE : THUMB_SYNC_PASSES;

  if (!activeExtractions.has(streamSessionId)) {
    activeExtractions.add(streamSessionId);
    try {
      if (!legacyCleaned.has(streamSessionId)) {
        await removeLegacyThumbs(framesDir);
        legacyCleaned.add(streamSessionId);
      }

      for (let pass = 0; pass < passes; pass++) {
        resolved = await resolveThumbnailInputPath(streamSessionId);
        if (!resolved) break;

        const starts = new Set(await listThumbStarts(framesDir));
        let missing = findMissingSparseBlocks(resolved.recorded, starts, {
          prioritizeTail,
          prioritizeHead,
        });
        if (missing.length === 0) break;

        if (isLive || resolved.recorded > THUMB_LIVE_STRIP_CHUNK_SECONDS) {
          // First paint: tiny head chunk. Later passes: larger windows.
          const chunkSeconds =
            starts.size < 4
              ? THUMB_LIVE_FIRST_CHUNK_SECONDS
              : THUMB_LIVE_STRIP_CHUNK_SECONDS;
          missing = limitThumbBlocksToChunk(missing, chunkSeconds);
        }

        const interval = thumbIntervalForDuration(resolved.recorded);
        try {
          await extractMissingRange(
            resolved.inputPath,
            framesDir,
            missing,
            interval,
            { fastGapFill: isLive }
          );
        } catch (error) {
          if (isMissingMediaError(error)) {
            seekableInputCache.delete(streamSessionId);
            const retry = await resolveThumbnailInputPath(streamSessionId);
            if (!retry || retry.inputPath === resolved.inputPath) break;
            await extractMissingRange(
              retry.inputPath,
              framesDir,
              missing,
              thumbIntervalForDuration(retry.recorded),
              { fastGapFill: isLive }
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
  options?: { isLive?: boolean; platform?: string | null }
): Promise<TimelineThumbnail[]> {
  const session = await prisma.streamSession.findUnique({
    where: { id: streamSessionId },
    select: { mode: true, platform: true },
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
    const isLive = options?.isLive ?? false;
    const platform = options?.platform ?? session?.platform ?? null;
    const prioritizeHead = true;
    const prioritizeTail = isLive && platform !== "kick";
    if (!activeExtractions.has(streamSessionId)) {
      void (async () => {
        // Priority + strip in parallel — don't block first paint on priority.
        await Promise.all([
          capturePriorityThumbs(streamSessionId, {
            prioritizeTail,
            prioritizeHead,
          }).catch((error) =>
            console.warn("[thumbnails] priority capture failed:", error)
          ),
          syncTimelineThumbnails(streamSessionId, {
            prioritizeTail,
            prioritizeHead,
            isLive,
          }).catch((error) => {
            if (isMissingMediaError(error)) {
              console.warn(
                "[thumbnails] source media disappeared mid-extract; will retry on next poll"
              );
              return;
            }
            console.error("[thumbnails] strip extraction failed:", error);
          }),
        ]);
      })();
    }
  }

  return existing;
}
