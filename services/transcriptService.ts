import path from "path";
import fs from "fs/promises";
import { prisma } from "@/lib/db";
import { toJsonValue } from "@/lib/utils";
import { extractAudio } from "@/lib/ffmpeg";
import { createEmbedding } from "@/lib/embeddings";
import { storeEmbedding } from "@/lib/rag";
import { resolveStoragePath } from "@/lib/storage";

export interface TranscriptSegment {
  startTimeSeconds: number;
  endTimeSeconds: number;
  text: string;
}

/** Pluggable transcription provider interface */
export interface TranscriptionProvider {
  transcribe(audioPath: string): Promise<TranscriptSegment[]>;
}

/**
 * Stub transcription provider — replace with OpenAI Whisper or other provider.
 * Returns placeholder segments based on audio duration for MVP demo flow.
 */
export class StubTranscriptionProvider implements TranscriptionProvider {
  async transcribe(audioPath: string): Promise<TranscriptSegment[]> {
    const { probeMedia } = await import("@/lib/ffmpeg");
    const probe = await probeMedia(audioPath);
    const duration = probe.durationSeconds;
    const segments: TranscriptSegment[] = [];
    const chunkSize = 10;

    for (let start = 0; start < duration; start += chunkSize) {
      const end = Math.min(start + chunkSize, duration);
      segments.push({
        startTimeSeconds: start,
        endTimeSeconds: end,
        text: `[Transcript placeholder ${Math.floor(start)}s-${Math.floor(end)}s — connect Whisper API for real transcription]`,
      });
    }

    return segments;
  }
}

let transcriptionProvider: TranscriptionProvider = new StubTranscriptionProvider();

export function setTranscriptionProvider(provider: TranscriptionProvider) {
  transcriptionProvider = provider;
}

export async function generateTranscript(
  streamSessionId: string,
  sourceFilePath: string
) {
  const audioDir = path.join(
    path.dirname(resolveStoragePath(sourceFilePath)),
    "audio"
  );
  await fs.mkdir(audioDir, { recursive: true });
  const audioPath = path.join(audioDir, "extracted.wav");

  await extractAudio(resolveStoragePath(sourceFilePath), audioPath);
  const segments = await transcriptionProvider.transcribe(audioPath);

  // Clear existing chunks
  await prisma.transcriptChunk.deleteMany({ where: { streamSessionId } });

  const created = [];
  for (const seg of segments) {
    const chunk = await prisma.transcriptChunk.create({
      data: {
        streamSessionId,
        startTimeSeconds: seg.startTimeSeconds,
        endTimeSeconds: seg.endTimeSeconds,
        text: seg.text,
        rawJson: toJsonValue(seg),
      },
    });

    try {
      const embedding = await createEmbedding(seg.text);
      await storeEmbedding("TranscriptChunk", chunk.id, embedding);
    } catch (e) {
      console.warn("Failed to embed transcript chunk:", e);
    }

    created.push(chunk);
  }

  return { chunks: created.length };
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
