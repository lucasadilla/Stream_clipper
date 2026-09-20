import path from "path";
import fs from "fs/promises";
import { prisma } from "@/lib/db";
import { toJsonValue } from "@/lib/utils";
import { extractAudio } from "@/lib/ffmpeg";
import { createEmbedding } from "@/lib/embeddings";
import { storeEmbedding } from "@/lib/rag";
import { resolveStoragePath } from "@/lib/storage";
import {
  isTranscriptionAvailable,
  transcribeAudioWithRouter,
} from "@/services/transcriptionRouterService";
import { syncTranscription } from "@/services/transcriptionSyncService";
import { resolveVideoDurationFromMetadata } from "@/lib/youtube";
import type { TranscriptSegment } from "@/lib/transcriptionTypes";

export type { TranscriptSegment } from "@/lib/transcriptionTypes";

/** Pluggable transcription provider interface */
export interface TranscriptionProvider {
  transcribe(audioPath: string): Promise<TranscriptSegment[]>;
}

export class OpenAIWhisperProvider implements TranscriptionProvider {
  async transcribe(audioPath: string): Promise<TranscriptSegment[]> {
    return transcribeAudioWithRouter(audioPath, 0, { workload: "vod" });
  }
}

/**
 * Fallback when no AI key is configured — returns empty (no fake placeholders).
 */
export class NoOpTranscriptionProvider implements TranscriptionProvider {
  async transcribe(): Promise<TranscriptSegment[]> {
    return [];
  }
}

let transcriptionProvider: TranscriptionProvider = isTranscriptionAvailable()
  ? new OpenAIWhisperProvider()
  : new NoOpTranscriptionProvider();

export function setTranscriptionProvider(provider: TranscriptionProvider) {
  transcriptionProvider = provider;
}

export async function generateTranscript(
  streamSessionId: string,
  sourceFilePath: string
) {
  if (!isTranscriptionAvailable()) {
    throw new Error(
      "Set DEEPGRAM_API_KEY, OPENROUTER_API_KEY, or OPENAI_API_KEY for transcription."
    );
  }

  await prisma.transcriptChunk.deleteMany({ where: { streamSessionId } });

  let totalSegments = 0;
  for (let pass = 0; pass < 200; pass++) {
    const result = await syncTranscription(streamSessionId, {
      isLive: false,
      parallel: 4,
    });
    if (result.reason === "already_processed") break;
    if (result.skipped && !result.transcribedSegments) break;
    totalSegments += result.transcribedSegments ?? 0;
    if ((result.transcribedThrough ?? 0) >= (result.recordedSeconds ?? 0)) break;
  }

  if (totalSegments === 0) {
    const audioDir = path.join(
      path.dirname(resolveStoragePath(sourceFilePath)),
      "audio"
    );
    await fs.mkdir(audioDir, { recursive: true });
    const audioPath = path.join(audioDir, "extracted.wav");
    await extractAudio(resolveStoragePath(sourceFilePath), audioPath);

    const segments = await transcriptionProvider.transcribe(audioPath);
    for (const seg of segments) {
      const chunk = await prisma.transcriptChunk.create({
        data: {
          streamSessionId,
          startTimeSeconds: seg.startTimeSeconds,
          endTimeSeconds: seg.endTimeSeconds,
          text: seg.text,
          rawJson: toJsonValue({ whisper: true }),
        },
      });
      try {
        const embedding = await createEmbedding(seg.text);
        await storeEmbedding("TranscriptChunk", chunk.id, embedding);
      } catch (e) {
        console.warn("Failed to embed transcript chunk:", e);
      }
      totalSegments++;
    }
  }

  const count = await prisma.transcriptChunk.count({
    where: { streamSessionId },
  });

  return { chunks: count };
}

export async function getTranscriptChunksForRange(
  streamSessionId: string,
  startTimeSeconds: number,
  endTimeSeconds: number
) {
  return prisma.transcriptChunk.findMany({
    where: {
      streamSessionId,
      startTimeSeconds: { lte: endTimeSeconds },
      endTimeSeconds: { gte: startTimeSeconds },
    },
    orderBy: { startTimeSeconds: "asc" },
  });
}

export async function getTranscriptionProgress(streamSessionId: string) {
  const searchableWhere = {
    streamSessionId,
    text: { notIn: ["", "[silence]", "[processing error]"] },
    NOT: [
      { text: { startsWith: "[Live " } },
      { text: { contains: "placeholder" } },
    ],
  };
  const [session, lastWhisper, searchableChunks] = await Promise.all([
    prisma.streamSession.findUnique({
      where: { id: streamSessionId },
      select: {
        metadataJson: true,
        actualStartTime: true,
        liveStatus: true,
        liveRecording: { select: { recordedSeconds: true } },
        sourceMedia: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { durationSeconds: true },
        },
      },
    }),
    prisma.transcriptChunk.findFirst({
      where: searchableWhere,
      orderBy: { endTimeSeconds: "desc" },
      select: { endTimeSeconds: true },
    }),
    prisma.transcriptChunk.count({ where: searchableWhere }),
  ]);

  const metadataDuration = session
    ? resolveVideoDurationFromMetadata(session.metadataJson, {
        actualStartTime: session.actualStartTime,
        liveStatus: session.liveStatus,
      })
    : 0;
  const recordedSeconds = Math.max(
    session?.sourceMedia[0]?.durationSeconds ?? 0,
    session?.liveRecording?.recordedSeconds ?? 0,
    metadataDuration
  );

  const transcribedSeconds = lastWhisper?.endTimeSeconds ?? 0;

  return {
    recordedSeconds,
    transcribedSeconds,
    chunkCount: searchableChunks,
    searchableChunks,
    isComplete:
      recordedSeconds > 0 && transcribedSeconds >= recordedSeconds - 3,
    whisperEnabled: isTranscriptionAvailable(),
  };
}
