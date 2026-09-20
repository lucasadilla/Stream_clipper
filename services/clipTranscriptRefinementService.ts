import fs from "fs/promises";
import path from "path";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  getClipTranscriptionRefinementModel,
  getTranscriptionLanguage,
} from "@/lib/aiProvider";
import { extractAudioSegment } from "@/lib/ffmpeg";
import { buildTranscriptionContext } from "@/lib/transcriptionContext";
import type { TranscriptWord } from "@/lib/transcriptionTypes";
import { ensureDir, getUploadDir } from "@/lib/storage";
import { toJsonValue } from "@/lib/utils";
import { transcribeWhisperAudio } from "@/services/whisperTranscription";
import { resolveSourceForTranscription } from "@/services/transcriptionSyncService";

const REFINEMENT_VERSION = "candidate-transcript-v1";
const inFlight = new Map<string, Promise<ClipTranscriptRefinementResult>>();

export interface ClipTranscriptRefinementResult {
  status: "refined" | "cached" | "skipped";
  reason?: string;
  updatedChunks: number;
  model?: string;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function joinWords(words: TranscriptWord[]): string {
  return words
    .map((word) => word.word.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+([,.;:!?%\]\)])/g, "$1")
    .replace(/([\[\(])\s+/g, "$1")
    .trim();
}

function clipMarker(value: unknown): Record<string, unknown> | null {
  const marker = objectValue(objectValue(value).transcriptRefinement);
  return marker.version === REFINEMENT_VERSION && marker.status === "completed"
    ? marker
    : null;
}

export function isClipTranscriptRefinementConfigured(): boolean {
  return Boolean(
    process.env.OPENAI_API_KEY?.trim() &&
      getClipTranscriptionRefinementModel()
  );
}

async function runRefinement(
  clipSuggestionId: string
): Promise<ClipTranscriptRefinementResult> {
  const model = getClipTranscriptionRefinementModel();
  if (!process.env.OPENAI_API_KEY?.trim() || !model) {
    return {
      status: "skipped",
      reason: "refinement_not_configured",
      updatedChunks: 0,
    };
  }

  const clip = await prisma.clipSuggestion.findUnique({
    where: { id: clipSuggestionId },
    select: {
      id: true,
      streamSessionId: true,
      startTimeSeconds: true,
      endTimeSeconds: true,
      rawAiJson: true,
      streamSession: {
        select: {
          title: true,
          description: true,
          channelTitle: true,
          liveStatus: true,
          sourceMedia: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { id: true, filePath: true },
          },
        },
      },
    },
  });
  if (!clip) {
    return { status: "skipped", reason: "clip_not_found", updatedChunks: 0 };
  }

  const cached = clipMarker(clip.rawAiJson);
  if (cached && cached.model === model) {
    return {
      status: "cached",
      updatedChunks: Number(cached.updatedChunks ?? 0),
      model,
    };
  }

  const sourceMedia = clip.streamSession.sourceMedia[0];
  if (!sourceMedia) {
    return { status: "skipped", reason: "source_not_ready", updatedChunks: 0 };
  }
  const sourcePath = await resolveSourceForTranscription(
    clip.streamSessionId,
    sourceMedia,
    { isLive: clip.streamSession.liveStatus === "live" }
  );
  if (!sourcePath) {
    return { status: "skipped", reason: "audio_not_ready", updatedChunks: 0 };
  }

  const originalChunks = await prisma.transcriptChunk.findMany({
    where: {
      streamSessionId: clip.streamSessionId,
      startTimeSeconds: { lt: clip.endTimeSeconds },
      endTimeSeconds: { gt: clip.startTimeSeconds },
    },
    orderBy: { startTimeSeconds: "asc" },
  });
  if (originalChunks.length === 0) {
    return { status: "skipped", reason: "no_transcript", updatedChunks: 0 };
  }

  const chatMessages = await prisma.chatMessage.findMany({
    where: {
      streamSessionId: clip.streamSessionId,
      videoTimeSeconds: {
        gte: Math.max(0, clip.startTimeSeconds - 180),
        lte: clip.endTimeSeconds + 30,
      },
    },
    orderBy: { publishedAt: "desc" },
    take: 80,
    select: { messageText: true },
  });
  const context = buildTranscriptionContext({
    title: clip.streamSession.title,
    description: clip.streamSession.description,
    channelTitle: clip.streamSession.channelTitle,
    previousTranscript: originalChunks.map((chunk) => chunk.text).join(" "),
    chatMessages: chatMessages.map((message) => message.messageText),
    language: getTranscriptionLanguage(),
  });

  const padding = 2;
  const audioStart = Math.max(0, clip.startTimeSeconds - padding);
  const audioEnd = clip.endTimeSeconds + padding;
  const audioDir = path.join(getUploadDir(clip.streamSessionId), "audio");
  await ensureDir(audioDir);
  const audioPath = path.join(
    audioDir,
    `refine-${clip.id}-${Date.now().toString(36)}.wav`
  );

  try {
    await extractAudioSegment(
      sourcePath,
      audioPath,
      audioStart,
      audioEnd - audioStart,
      { accurateSeek: true }
    );
    const refined = await transcribeWhisperAudio(audioPath, audioStart, {
      prompt: context.prompt,
      language: context.language,
      keyterms: context.keyterms,
      providerOrder: ["openai"],
      qualityModel: model,
    });
    const words = refined
      .flatMap((segment) => segment.words ?? [])
      .filter((word) => {
        const midpoint = (word.start + word.end) / 2;
        return (
          midpoint >= clip.startTimeSeconds && midpoint < clip.endTimeSeconds
        );
      })
      .sort((a, b) => a.start - b.start);
    const timingModel =
      refined.find((segment) => segment.timingModel)?.timingModel ??
      "whisper-1";
    if (words.length === 0) {
      return {
        status: "skipped",
        reason: "no_refined_words",
        updatedChunks: 0,
        model,
      };
    }

    const updates = originalChunks.flatMap((chunk) => {
      const chunkWords = words.filter((word) => {
        const midpoint = (word.start + word.end) / 2;
        return (
          midpoint >= chunk.startTimeSeconds && midpoint < chunk.endTimeSeconds
        );
      });
      const text = joinWords(chunkWords);
      if (!text) return [];
      const previousRaw = objectValue(chunk.rawJson);
      return [
        prisma.transcriptChunk.update({
          where: { id: chunk.id },
          data: {
            text,
            rawJson: toJsonValue({
              ...previousRaw,
              rawTranscript:
                previousRaw.rawTranscript ??
                previousRaw.canonicalTranscript ??
                chunk.text,
              canonicalTranscript: text,
              words: chunkWords,
              provider: "openai",
              model,
              timingModel,
              transcriptRefinement: {
                version: REFINEMENT_VERSION,
                refinedAt: new Date().toISOString(),
                model,
              },
            }),
          },
        }),
      ];
    });

    if (updates.length > 0) await prisma.$transaction(updates);
    const rawAiJson = objectValue(clip.rawAiJson);
    await prisma.clipSuggestion.update({
      where: { id: clip.id },
      data: {
        captionDirection: Prisma.JsonNull,
        rawAiJson: toJsonValue({
          ...rawAiJson,
          transcriptRefinement: {
            version: REFINEMENT_VERSION,
            status: "completed",
            model,
            updatedChunks: updates.length,
            refinedAt: new Date().toISOString(),
          },
        }),
      },
    });

    return {
      status: "refined",
      updatedChunks: updates.length,
      model,
    };
  } finally {
    await fs.unlink(audioPath).catch(() => {});
  }
}

export async function refineClipTranscript(
  clipSuggestionId: string
): Promise<ClipTranscriptRefinementResult> {
  const existing = inFlight.get(clipSuggestionId);
  if (existing) return existing;
  const promise = runRefinement(clipSuggestionId);
  inFlight.set(clipSuggestionId, promise);
  try {
    return await promise;
  } finally {
    if (inFlight.get(clipSuggestionId) === promise) {
      inFlight.delete(clipSuggestionId);
    }
  }
}
