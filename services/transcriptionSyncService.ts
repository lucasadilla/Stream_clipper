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
import { extractAudioSegment } from "@/lib/ffmpeg";
import { createEmbeddingsBatch } from "@/lib/embeddings";
import { storeEmbedding } from "@/lib/rag";
import {
  ensureDir,
  resolveStoragePath,
  getUploadDir,
  findBestSourceFileInDir,
  toRelativeStoragePath,
} from "@/lib/storage";
import type { TranscriptSegment } from "@/services/transcriptService";
import {
  isWhisperAvailable,
  transcribeWhisperAudio,
} from "@/services/whisperTranscription";

const MIN_SEGMENT_SECONDS = 3;

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

async function getLastTranscribedEnd(streamSessionId: string): Promise<number> {
  const rows = await prisma.transcriptChunk.findMany({
    where: { streamSessionId },
    orderBy: { endTimeSeconds: "desc" },
    take: 20,
    select: { endTimeSeconds: true, rawJson: true, text: true },
  });

  for (const row of rows) {
    if (isPlaceholderTranscript(row.text)) continue;
    const raw = row.rawJson as { whisper?: boolean } | null;
    if (raw?.whisper) return row.endTimeSeconds;
  }
  return 0;
}

async function resolveSourceForTranscription(
  streamSessionId: string,
  sourceMedia: { id: string; filePath: string }
): Promise<string | null> {
  const primary = resolveStoragePath(sourceMedia.filePath);
  if (existsSync(primary)) return primary;

  const found = await findBestSourceFileInDir(getUploadDir(streamSessionId));
  if (!found) return null;

  const relative = toRelativeStoragePath(found);
  await prisma.sourceMedia.update({
    where: { id: sourceMedia.id },
    data: { filePath: relative },
  });
  return found;
}

async function markRangeProcessed(
  streamSessionId: string,
  startSeconds: number,
  endSeconds: number,
  reason: "silent" | "error"
) {
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
      }),
    },
  });
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

function buildTranscriptionRanges(
  fromSeconds: number,
  recordedSeconds: number,
  budgetSeconds: number
) {
  const ranges: Array<{ start: number; end: number }> = [];
  let cursor = fromSeconds;
  const targetEnd = Math.min(recordedSeconds, fromSeconds + budgetSeconds);
  while (cursor < targetEnd - MIN_SEGMENT_SECONDS) {
    const end = Math.min(cursor + TRANSCRIPTION_CHUNK_SECONDS, targetEnd);
    if (end - cursor < MIN_SEGMENT_SECONDS) break;
    ranges.push({ start: cursor, end });
    cursor = end;
  }
  return ranges;
}

export async function persistTranscriptSegments(
  streamSessionId: string,
  segments: TranscriptSegment[],
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
            segmentStart: meta.segmentStart,
            segmentEnd: meta.segmentEnd,
          }),
        },
      })
    )
  );

  try {
    const embeddings = await createEmbeddingsBatch(
      speechSegments.map((s) => s.text)
    );
    await Promise.all(
      created.map((chunk, i) =>
        storeEmbedding("TranscriptChunk", chunk.id, embeddings[i]!)
      )
    );
  } catch (e) {
    console.warn("Failed to embed transcript chunks:", e);
  }

  return created;
}

async function transcribeVideoRange(
  streamSessionId: string,
  inputPath: string,
  startSeconds: number,
  endSeconds: number
) {
  const duration = endSeconds - startSeconds;
  if (duration < MIN_SEGMENT_SECONDS) {
    return { segments: 0, skipped: true, reason: "too_short" as const };
  }

  const audioDir = path.join(path.dirname(inputPath), "audio");
  await ensureDir(audioDir);
  const audioPath = path.join(
    audioDir,
    `segment-${Math.floor(startSeconds)}-${Math.floor(endSeconds)}.wav`
  );

  try {
    await extractAudioSegment(inputPath, audioPath, startSeconds, duration);
  } catch (err) {
    console.error("[transcribe] ffmpeg extract failed:", err);
    await markRangeProcessed(streamSessionId, startSeconds, endSeconds, "error");
    return { segments: 0, skipped: true, reason: "extract_failed" as const };
  }

  let segments: TranscriptSegment[];
  try {
    segments = await transcribeWhisperAudio(audioPath, startSeconds);
  } catch (err) {
    console.error("[transcribe] whisper failed:", err);
    await markRangeProcessed(streamSessionId, startSeconds, endSeconds, "error");
    return { segments: 0, skipped: true, reason: "whisper_failed" as const };
  } finally {
    await fs.unlink(audioPath).catch(() => {});
  }

  if (segments.length === 0) {
    await markRangeProcessed(streamSessionId, startSeconds, endSeconds, "silent");
    return { segments: 0, skipped: true, reason: "silent" as const };
  }

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

export interface TranscriptionSyncResult {
  skipped: boolean;
  reason?: string;
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

  const sourceMedia = await prisma.sourceMedia.findFirst({
    where: { streamSessionId },
    orderBy: { createdAt: "desc" },
  });
  if (!sourceMedia) return { skipped: true, reason: "no_media" };

  const inputPath = await resolveSourceForTranscription(
    streamSessionId,
    sourceMedia
  );
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

  const fromSeconds = await getLastTranscribedEnd(streamSessionId);
  const ranges = buildTranscriptionRanges(fromSeconds, recorded, budgetSeconds);

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

  for (let i = 0; i < ranges.length; i += parallel) {
    const wave = ranges.slice(i, i + parallel);
    const results = await Promise.all(
      wave.map((r) =>
        transcribeVideoRange(
          streamSessionId,
          inputPath,
          r.start,
          r.end
        )
      )
    );

    for (let j = 0; j < wave.length; j++) {
      const range = wave[j]!;
      const result = results[j]!;
      transcribedThrough = Math.max(transcribedThrough, range.end);
      audioSecondsProcessed += range.end - range.start;
      if (!result.skipped) transcribedSegments += result.segments;
    }
  }

  return {
    skipped: transcribedSegments === 0 && transcribedThrough <= fromSeconds,
    reason:
      transcribedSegments === 0
        ? ranges.length > 0
          ? "silent"
          : "already_processed"
        : undefined,
    transcribedSegments,
    transcribedThrough,
    recordedSeconds: recorded,
    placeholdersRemoved,
    chunksProcessed: ranges.length,
    audioSecondsProcessed,
  };
}
