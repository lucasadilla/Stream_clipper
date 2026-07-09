import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import { prisma } from "@/lib/db";
import { toJsonValue } from "@/lib/utils";
import {
  TRANSCRIPTION_BUDGET_LIVE_SECONDS,
  TRANSCRIPTION_BUDGET_VOD_SECONDS,
  TRANSCRIPTION_CHUNK_SECONDS,
  TRANSCRIPTION_PARALLEL,
} from "@/lib/transcriptionConstants";
import { extractAudioSegment, hasAudioStream } from "@/lib/ffmpeg";
import {
  EMBED_TRANSCRIPT_CHUNKS,
} from "@/lib/aiCostConstants";
import { createEmbeddingsBatch } from "@/lib/embeddings";
import { storeEmbedding } from "@/lib/rag";
import {
  ensureDir,
  resolveStoragePath,
  getUploadDir,
  findBestSourceFileInDir,
  listSourceCandidateFiles,
  toRelativeStoragePath,
} from "@/lib/storage";
import type { TranscriptSegment } from "@/services/transcriptService";
import {
  isProviderUnavailableError,
  isWhisperAvailable,
  transcribeWhisperAudio,
} from "@/services/whisperTranscription";
import { ensureLocalSourceMedia } from "@/services/sourceMediaRepairService";

const MIN_SEGMENT_SECONDS = 3;
/** Give a failing range this many tries before permanently skipping it. */
const MAX_RANGE_ATTEMPTS = 3;

/** Session → audio-capable source path (live recordings split audio/video files). */
const audioSourceCache = new Map<string, { path: string; checkedAt: number }>();
const AUDIO_SOURCE_CACHE_MS = 5 * 60 * 1000;

/** One transcription run per session at a time (browser polls + API can overlap). */
const activeSyncs = new Set<string>();

export function clearSessionTranscriptionState(streamSessionId: string) {
  audioSourceCache.delete(streamSessionId);
}

export async function waitForTranscriptionIdle(
  streamSessionId: string,
  timeoutMs = 45000
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (activeSyncs.has(streamSessionId)) {
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, 250));
  }
  return true;
}

export function isPlaceholderTranscript(text: string): boolean {
  return (
    /^\[Live \d+s/i.test(text) ||
    /placeholder/i.test(text) ||
    /connect Whisper/i.test(text)
  );
}

export function isCursorOnlyChunk(rawJson: unknown): boolean {
  if (!rawJson || typeof rawJson !== "object") return false;
  return (rawJson as { cursorOnly?: boolean }).cursorOnly === true;
}

/** Remove all Whisper transcript rows so timing can be rebuilt with word-level cues. */
export async function clearWhisperTranscriptChunks(streamSessionId: string) {
  const rows = await prisma.transcriptChunk.findMany({
    where: { streamSessionId },
    select: { id: true, rawJson: true },
  });
  const whisperIds = rows
    .filter((r) => {
      const meta = r.rawJson as { whisper?: boolean } | null;
      return meta?.whisper === true;
    })
    .map((r) => r.id);
  if (whisperIds.length === 0) return 0;
  await prisma.transcriptChunk.deleteMany({ where: { id: { in: whisperIds } } });
  clearSessionTranscriptionState(streamSessionId);
  return whisperIds.length;
}

export async function removePlaceholderChunks(streamSessionId: string) {
  const chunks = await prisma.transcriptChunk.findMany({
    where: { streamSessionId },
    select: { id: true, text: true },
  });
  const placeholderIds = chunks
    .filter((c) => isPlaceholderTranscript(c.text))
    .map((c) => c.id);
  if (placeholderIds.length === 0) return 0;
  await prisma.transcriptChunk.deleteMany({
    where: { id: { in: placeholderIds } },
  });
  return placeholderIds.length;
}

/** Small silences between Whisper segments inside one processed range. */
const COVERAGE_MERGE_TOLERANCE_SECONDS = 15;

interface CoverageInfo {
  /** Merged intervals of audio already processed (speech, silence, exhausted errors). */
  intervals: Array<{ start: number; end: number }>;
  /** Highest processed timestamp — the live-edge frontier. */
  frontier: number;
}

async function getTranscriptionCoverage(
  streamSessionId: string
): Promise<CoverageInfo> {
  const rows = await prisma.transcriptChunk.findMany({
    where: { streamSessionId },
    orderBy: { startTimeSeconds: "asc" },
    select: {
      startTimeSeconds: true,
      endTimeSeconds: true,
      text: true,
      rawJson: true,
    },
  });

  const raw: Array<{ start: number; end: number }> = [];
  for (const row of rows) {
    if (isPlaceholderTranscript(row.text)) continue;
    const meta = row.rawJson as {
      whisper?: boolean;
      reason?: string;
      attempts?: number;
      segmentStart?: number;
      segmentEnd?: number;
    } | null;
    if (!meta?.whisper) continue;
    // Error markers stay retryable (uncovered) until attempts run out.
    if (meta.reason === "error" && (meta.attempts ?? 1) < MAX_RANGE_ATTEMPTS) {
      continue;
    }
    raw.push({
      start: meta.segmentStart ?? row.startTimeSeconds,
      end: meta.segmentEnd ?? row.endTimeSeconds,
    });
  }

  raw.sort((a, b) => a.start - b.start);
  const intervals: Array<{ start: number; end: number }> = [];
  for (const cur of raw) {
    const last = intervals[intervals.length - 1];
    if (last && cur.start <= last.end + COVERAGE_MERGE_TOLERANCE_SECONDS) {
      last.end = Math.max(last.end, cur.end);
    } else {
      intervals.push({ ...cur });
    }
  }

  const frontier = intervals.reduce((max, iv) => Math.max(max, iv.end), 0);
  return { intervals, frontier };
}

async function getLastTranscribedEnd(streamSessionId: string): Promise<number> {
  const { frontier } = await getTranscriptionCoverage(streamSessionId);
  return frontier;
}

/**
 * Find a source file that actually contains an audio stream.
 * Live yt-dlp recordings are split into video-only (f299) and audio-only
 * (f140) files until merged, so the sourceMedia filePath (video) has no audio.
 */
async function resolveSourceForTranscription(
  streamSessionId: string,
  sourceMedia: { id: string; filePath: string }
): Promise<string | null> {
  const cached = audioSourceCache.get(streamSessionId);
  if (
    cached &&
    Date.now() - cached.checkedAt < AUDIO_SOURCE_CACHE_MS &&
    existsSync(cached.path)
  ) {
    return cached.path;
  }

  const primary = (() => {
    try {
      return resolveStoragePath(sourceMedia.filePath);
    } catch {
      return null;
    }
  })();

  // listSourceCandidateFiles orders merged file first, then smallest first —
  // audio-only tracks are far smaller than video, so they get probed early.
  const uploadDir = getUploadDir(streamSessionId);
  const candidates = await listSourceCandidateFiles(uploadDir);
  if (primary && existsSync(primary) && !candidates.includes(primary)) {
    candidates.push(primary);
  }
  if (candidates.length === 0) return null;

  for (const file of candidates) {
    if (await hasAudioStream(file)) {
      audioSourceCache.set(streamSessionId, { path: file, checkedAt: Date.now() });
      return file;
    }
  }

  // No audio anywhere — keep old behavior of repairing a dead filePath pointer.
  if (!primary || !existsSync(primary)) {
    const found = await findBestSourceFileInDir(uploadDir);
    if (found) {
      await prisma.sourceMedia.update({
        where: { id: sourceMedia.id },
        data: { filePath: toRelativeStoragePath(found) },
      });
    }
  }
  return null;
}

async function markRangeProcessed(
  streamSessionId: string,
  startSeconds: number,
  endSeconds: number,
  reason: "silent" | "error"
) {
  // Fold any overlapping markers into one so retries bump a single attempts
  // counter even when chunk boundaries shift between runs.
  const overlapping = await prisma.transcriptChunk.findMany({
    where: {
      streamSessionId,
      startTimeSeconds: { lt: endSeconds },
      endTimeSeconds: { gt: startSeconds },
    },
    select: { id: true, rawJson: true },
  });
  const markers = overlapping.filter((c) => isCursorOnlyChunk(c.rawJson));
  const prevAttempts = markers.reduce(
    (max, c) =>
      Math.max(max, (c.rawJson as { attempts?: number }).attempts ?? 1),
    0
  );
  if (markers.length > 0) {
    await prisma.transcriptChunk.deleteMany({
      where: { id: { in: markers.map((c) => c.id) } },
    });
  }

  await prisma.transcriptChunk.create({
    data: {
      streamSessionId,
      startTimeSeconds: startSeconds,
      endTimeSeconds: endSeconds,
      text: reason === "silent" ? "[silence]" : "[processing error]",
      rawJson: toJsonValue({
        whisper: true,
        cursorOnly: true,
        reason,
        attempts: prevAttempts + 1,
      }),
    },
  });
}

/**
 * Remove stale whisper output contained in a range about to be re-persisted:
 * error/silence markers plus any duplicate speech chunks from a previous run.
 */
async function clearChunksInRange(
  streamSessionId: string,
  startSeconds: number,
  endSeconds: number
) {
  const contained = await prisma.transcriptChunk.findMany({
    where: {
      streamSessionId,
      startTimeSeconds: { gte: startSeconds - 1 },
      endTimeSeconds: { lte: endSeconds + 1 },
    },
    select: { id: true, rawJson: true },
  });
  const ids = contained
    .filter((c) => (c.rawJson as { whisper?: boolean } | null)?.whisper)
    .map((c) => c.id);
  if (ids.length > 0) {
    await prisma.transcriptChunk.deleteMany({ where: { id: { in: ids } } });
  }
}

export async function getTranscriptionBacklog(streamSessionId: string) {
  const sourceMedia = await prisma.sourceMedia.findFirst({
    where: { streamSessionId },
    orderBy: { createdAt: "desc" },
    select: { durationSeconds: true, filePath: true },
  });
  const recordedSeconds = sourceMedia?.durationSeconds ?? 0;
  const transcribedThrough = await getLastTranscribedEnd(streamSessionId);
  const fileReady = sourceMedia
    ? existsSync(resolveStoragePath(sourceMedia.filePath)) ||
      !!(await findBestSourceFileInDir(getUploadDir(streamSessionId)))
    : false;

  return {
    backlogSeconds: Math.max(0, recordedSeconds - transcribedThrough),
    recordedSeconds,
    transcribedThrough,
    fileReady,
  };
}

/** Uncovered gaps in [0, recordedSeconds], capped at budgetSeconds total. */
function buildGapRanges(
  coverage: CoverageInfo,
  recordedSeconds: number,
  budgetSeconds: number
) {
  const gaps: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  for (const iv of coverage.intervals) {
    if (iv.start - cursor >= MIN_SEGMENT_SECONDS) {
      gaps.push({ start: cursor, end: Math.min(iv.start, recordedSeconds) });
    }
    cursor = Math.max(cursor, iv.end);
  }
  if (recordedSeconds - cursor >= MIN_SEGMENT_SECONDS) {
    gaps.push({ start: cursor, end: recordedSeconds });
  }

  // Split gaps into Whisper-sized ranges (25 MB upload cap) within the budget.
  const ranges: Array<{ start: number; end: number }> = [];
  let budgetLeft = budgetSeconds;
  for (const gap of gaps) {
    let at = gap.start;
    while (at < gap.end - MIN_SEGMENT_SECONDS && budgetLeft >= MIN_SEGMENT_SECONDS) {
      const end = Math.min(
        at + Math.min(TRANSCRIPTION_CHUNK_SECONDS, budgetLeft),
        gap.end
      );
      if (end - at < MIN_SEGMENT_SECONDS) break;
      ranges.push({ start: at, end });
      budgetLeft -= end - at;
      at = end;
    }
    if (budgetLeft < MIN_SEGMENT_SECONDS) break;
  }
  return ranges;
}

export async function persistTranscriptSegments(
  streamSessionId: string,
  segments: Array<{
    startTimeSeconds: number;
    endTimeSeconds: number;
    text: string;
    estimatedTiming?: boolean;
    words?: Array<{ start: number; end: number; word: string }>;
  }>,
  meta: { segmentStart: number; segmentEnd: number }
) {
  if (segments.length === 0) return [];

  const speechSegments = segments.filter((s) => s.text.trim().length > 0);
  if (speechSegments.length === 0) return [];

  const created = await Promise.all(
    speechSegments.map((seg) =>
      prisma.transcriptChunk.create({
        data: {
          streamSessionId,
          startTimeSeconds: seg.startTimeSeconds,
          endTimeSeconds: seg.endTimeSeconds,
          text: seg.text,
          rawJson: toJsonValue({
            whisper: true,
            estimatedTiming: seg.estimatedTiming ?? false,
            segmentStart: meta.segmentStart,
            segmentEnd: meta.segmentEnd,
            ...(seg.words && seg.words.length > 0 ? { words: seg.words } : {}),
          }),
        },
      })
    )
  );

  try {
    if (EMBED_TRANSCRIPT_CHUNKS) {
      const embeddings = await createEmbeddingsBatch(
        speechSegments.map((s) => s.text)
      );
      await Promise.all(
        created.map((chunk, i) =>
          storeEmbedding("TranscriptChunk", chunk.id, embeddings[i]!)
        )
      );
    }
  } catch (e) {
    console.warn("Failed to embed transcript chunks:", e);
  }

  return created;
}

/** Transcribe a range whose audio has already been extracted to a WAV file. */
async function transcribeAudioRange(
  streamSessionId: string,
  audioPath: string,
  startSeconds: number,
  endSeconds: number
) {
  let segments: TranscriptSegment[];
  try {
    segments = await transcribeWhisperAudio(audioPath, startSeconds);
  } catch (err) {
    console.error("[transcribe] whisper failed:", err);
    // Quota/network outages: leave the range uncovered so it retries cleanly
    // once the provider recovers, instead of consuming error attempts.
    if (isProviderUnavailableError(err)) {
      return {
        segments: 0,
        skipped: true,
        reason: "provider_unavailable" as const,
        error: err instanceof Error ? err.message : String(err),
      };
    }
    await markRangeProcessed(streamSessionId, startSeconds, endSeconds, "error");
    return { segments: 0, skipped: true, reason: "whisper_failed" as const };
  } finally {
    await fs.unlink(audioPath).catch(() => {});
  }

  if (segments.length === 0) {
    await markRangeProcessed(streamSessionId, startSeconds, endSeconds, "silent");
    return { segments: 0, skipped: true, reason: "silent" as const };
  }

  await clearChunksInRange(streamSessionId, startSeconds, endSeconds);
  const created = await persistTranscriptSegments(streamSessionId, segments, {
    segmentStart: startSeconds,
    segmentEnd: endSeconds,
  });

  if (created.length === 0) {
    await markRangeProcessed(streamSessionId, startSeconds, endSeconds, "silent");
    return { segments: 0, skipped: true, reason: "silent" as const };
  }

  return { segments: created.length, skipped: false as const };
}

interface PreparedChunk {
  start: number;
  end: number;
  audioPath: string;
}

/**
 * Extract audio for a contiguous span with ONE seek into the source (seeking a
 * growing live file costs 60s+), then split the WAV locally (near-instant).
 * Returns ready per-chunk WAVs plus ranges whose audio isn't on disk yet.
 */
async function prepareGroupAudio(
  streamSessionId: string,
  inputPath: string,
  group: Array<{ start: number; end: number }>,
  recordedSeconds: number
): Promise<{ chunks: PreparedChunk[]; notReady: boolean }> {
  const groupStart = group[0]!.start;
  const groupEnd = group[group.length - 1]!.end;

  const audioDir = path.join(path.dirname(inputPath), "audio");
  await ensureDir(audioDir);
  const groupWav = path.join(
    audioDir,
    `span-${Math.floor(groupStart)}-${Math.floor(groupEnd)}.wav`
  );

  try {
    await extractAudioSegment(
      inputPath,
      groupWav,
      groupStart,
      groupEnd - groupStart,
      { accurateSeek: true }
    );
  } catch (err) {
    console.error("[transcribe] ffmpeg extract failed:", err);
    for (const r of group) {
      await markRangeProcessed(streamSessionId, r.start, r.end, "error");
    }
    return { chunks: [], notReady: false };
  }

  // 16 kHz mono s16 → 32 kB per second. A short WAV means the tail of this
  // span isn't written to disk yet (real silence still fills the full length).
  const actualBytes = await fs
    .stat(groupWav)
    .then((s) => s.size)
    .catch(() => 0);
  const availableSeconds = Math.max(0, (actualBytes - 44) / 32000);

  const chunks: PreparedChunk[] = [];
  let notReady = false;

  for (const r of group) {
    const relStart = r.start - groupStart;
    const relEnd = r.end - groupStart;
    if (relEnd > availableSeconds + 1) {
      if (r.end >= recordedSeconds - 180) {
        notReady = true;
        continue;
      }
      await markRangeProcessed(streamSessionId, r.start, r.end, "error");
      continue;
    }

    const chunkWav = path.join(
      audioDir,
      `segment-${Math.floor(r.start)}-${Math.floor(r.end)}.wav`
    );
    try {
      await extractAudioSegment(groupWav, chunkWav, relStart, relEnd - relStart, {
        accurateSeek: true,
      });
      chunks.push({ start: r.start, end: r.end, audioPath: chunkWav });
    } catch (err) {
      console.error("[transcribe] wav split failed:", err);
      await markRangeProcessed(streamSessionId, r.start, r.end, "error");
    }
  }

  await fs.unlink(groupWav).catch(() => {});
  return { chunks, notReady };
}

/** Group ranges that are back-to-back so each group needs a single source seek. */
function groupContiguousRanges(ranges: Array<{ start: number; end: number }>) {
  const groups: Array<Array<{ start: number; end: number }>> = [];
  for (const r of ranges) {
    const last = groups[groups.length - 1];
    if (last && Math.abs(last[last.length - 1]!.end - r.start) < 0.01) {
      last.push(r);
    } else {
      groups.push([r]);
    }
  }
  return groups;
}

export interface TranscriptionSyncResult {
  skipped: boolean;
  reason?: string;
  error?: string;
  transcribedSegments?: number;
  transcribedThrough?: number;
  recordedSeconds?: number;
  placeholdersRemoved?: number;
  chunksProcessed?: number;
  audioSecondsProcessed?: number;
}

export interface TranscriptionSyncOptions {
  isLive?: boolean;
  budgetSeconds?: number;
  parallel?: number;
}

export async function syncTranscription(
  streamSessionId: string,
  options: TranscriptionSyncOptions = {}
): Promise<TranscriptionSyncResult> {
  if (!isWhisperAvailable()) {
    return { skipped: true, reason: "no_openai_key" };
  }
  if (activeSyncs.has(streamSessionId)) {
    return { skipped: true, reason: "sync_in_progress" };
  }
  activeSyncs.add(streamSessionId);
  try {
    return await runSyncTranscription(streamSessionId, options);
  } finally {
    activeSyncs.delete(streamSessionId);
  }
}

async function runSyncTranscription(
  streamSessionId: string,
  options: TranscriptionSyncOptions
): Promise<TranscriptionSyncResult> {

  const sourceMedia = await ensureLocalSourceMedia(streamSessionId);
  if (!sourceMedia) return { skipped: true, reason: "no_media" };

  let inputPath = await resolveSourceForTranscription(
    streamSessionId,
    sourceMedia
  );
  if (!inputPath) {
    const repairedSourceMedia = await ensureLocalSourceMedia(streamSessionId);
    inputPath = repairedSourceMedia
      ? await resolveSourceForTranscription(streamSessionId, repairedSourceMedia)
      : null;
  }
  if (!inputPath) {
    return { skipped: true, reason: "no_file", recordedSeconds: 0 };
  }

  const recorded = sourceMedia.durationSeconds ?? 0;
  if (recorded < MIN_SEGMENT_SECONDS) {
    return { skipped: true, reason: "too_short", recordedSeconds: recorded };
  }

  const placeholdersRemoved = await removePlaceholderChunks(streamSessionId);
  const isLive = options.isLive ?? false;
  const budgetSeconds =
    options.budgetSeconds ??
    (isLive ? TRANSCRIPTION_BUDGET_LIVE_SECONDS : TRANSCRIPTION_BUDGET_VOD_SECONDS);
  const parallel = options.parallel ?? TRANSCRIPTION_PARALLEL;

  const coverage = await getTranscriptionCoverage(streamSessionId);
  const fromSeconds = coverage.frontier;
  const ranges = buildGapRanges(coverage, recorded, budgetSeconds);

  if (ranges.length === 0) {
    return {
      skipped: true,
      reason: "already_processed",
      transcribedThrough: fromSeconds,
      recordedSeconds: recorded,
      placeholdersRemoved,
    };
  }

  let transcribedSegments = 0;
  let transcribedThrough = fromSeconds;
  let audioSecondsProcessed = 0;

  // Seeking into a growing DASH recording costs up to ~80s, so each call pays
  // for exactly ONE seek: process only the first contiguous gap group. The
  // steady polling loop works through remaining gaps on subsequent calls.
  const group = groupContiguousRanges(ranges)[0]!;
  const { chunks } = await prepareGroupAudio(
    streamSessionId,
    inputPath,
    group,
    recorded
  );

  let providerError: string | null = null;

  outer: for (let i = 0; i < chunks.length; i += parallel) {
    const wave = chunks.slice(i, i + parallel);
    const results = await Promise.all(
      wave.map((c) =>
        transcribeAudioRange(streamSessionId, c.audioPath, c.start, c.end)
      )
    );

    for (let j = 0; j < wave.length; j++) {
      const chunk = wave[j]!;
      const result = results[j]!;
      if (result.skipped && result.reason === "provider_unavailable") {
        providerError = result.error ?? "OpenAI is unreachable";
        // Clean up remaining prepared WAVs; ranges stay uncovered for retry.
        for (const rest of chunks.slice(i)) {
          await fs.unlink(rest.audioPath).catch(() => {});
        }
        break outer;
      }
      transcribedThrough = Math.max(transcribedThrough, chunk.end);
      audioSecondsProcessed += chunk.end - chunk.start;
      if (!result.skipped) transcribedSegments += result.segments;
    }
  }

  if (providerError && transcribedSegments === 0) {
    return {
      skipped: true,
      reason: "provider_unavailable",
      error: providerError,
      transcribedThrough: fromSeconds,
      recordedSeconds: recorded,
      placeholdersRemoved,
    };
  }

  return {
    skipped: transcribedSegments === 0 && transcribedThrough <= fromSeconds,
    reason:
      transcribedSegments === 0
        ? ranges.length > 0
          ? "silent"
          : "already_processed"
        : providerError
          ? "provider_unavailable"
          : undefined,
    error: providerError ?? undefined,
    transcribedSegments,
    transcribedThrough,
    recordedSeconds: recorded,
    placeholdersRemoved,
    chunksProcessed: ranges.length,
    audioSecondsProcessed,
  };
}
