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
import { alignWordsToSpeakerContext } from "@/lib/speakerContext";
import { ensureDir, getUploadDir } from "@/lib/storage";
import { toJsonValue } from "@/lib/utils";
import { transcribeClipAccurately } from "@/services/accurateClipTranscriptionService";
import { resolveSourceForTranscription } from "@/services/transcriptionSyncService";
import { ensureSpeakerContext } from "@/services/speakerContextService";

const REFINEMENT_VERSION = "candidate-transcript-v2";
const inFlight = new Map<string, Promise<ClipTranscriptRefinementResult>>();

interface RefinementSource {
  inputPath: string;
  timelineOffsetSeconds: number;
  startTimeSeconds?: number;
  endTimeSeconds?: number;
}

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
  clipSuggestionId: string,
  source?: RefinementSource
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

  const clipStart = source?.startTimeSeconds ?? clip.startTimeSeconds;
  const clipEnd = source?.endTimeSeconds ?? clip.endTimeSeconds;

  const cached = clipMarker(clip.rawAiJson);
  const sourceKey = source?.inputPath ?? "preview";
  if (cached && cached.model === model && (!source || cached.sourceKey === sourceKey) &&
    cached.start === clipStart && cached.end === clipEnd) {
    return {
      status: "cached",
      updatedChunks: Number(cached.updatedChunks ?? 0),
      model,
    };
  }

  const sourceMedia = clip.streamSession.sourceMedia[0];
  if (!sourceMedia && !source) {
    return { status: "skipped", reason: "source_not_ready", updatedChunks: 0 };
  }
  const sourcePath = source?.inputPath ?? await resolveSourceForTranscription(
    clip.streamSessionId,
    sourceMedia!,
    { isLive: clip.streamSession.liveStatus === "live" }
  );
  if (!sourcePath) {
    return { status: "skipped", reason: "audio_not_ready", updatedChunks: 0 };
  }

  const originalChunks = await prisma.transcriptChunk.findMany({
    where: {
      streamSessionId: clip.streamSessionId,
      startTimeSeconds: { lt: clipEnd },
      endTimeSeconds: { gt: clipStart },
    },
    orderBy: { startTimeSeconds: "asc" },
  });
  // Capture the source-level speaker timeline before the higher-quality text
  // pass replaces words. Whisper improves wording/timing but does not diarize;
  // re-aligning here prevents final renders from losing speaker identity.
  const speakerContext = await ensureSpeakerContext(clip.streamSessionId).catch(
    () => null
  );

  const chatMessages = await prisma.chatMessage.findMany({
    where: {
      streamSessionId: clip.streamSessionId,
      videoTimeSeconds: {
        gte: Math.max(0, clipStart - 180),
        lte: clipEnd + 30,
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
  const sourceOffset = source?.timelineOffsetSeconds ?? 0;
  const audioStart = Math.max(sourceOffset, clipStart - padding);
  const audioEnd = clipEnd + padding;
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
      audioStart - sourceOffset,
      audioEnd - audioStart,
      { accurateSeek: true }
    );
    const refined = await transcribeClipAccurately({
      sourcePath: audioPath,
      sourceStart: 0,
      timelineStart: audioStart,
      duration: audioEnd - audioStart,
      tempDir: audioDir,
      options: {
        // Keep context out of Whisper's timing pass: it can repeat hints in
        // quiet windows. The correction model accepts recording context.
        qualityPrompt: [
          "A livestream with a creator addressing viewers as chat, with occasional donation messages.",
          context.language ? `Spoken language: ${context.language}.` : "",
          clip.streamSession.channelTitle ? `Creator: ${clip.streamSession.channelTitle}.` : "",
        ].filter(Boolean).join(" "),
        language: context.language,
        keyterms: context.keyterms,
        providerOrder: ["openai"],
        qualityModel: model,
      },
    });
    const refinedWords = refined
      .flatMap((segment) => segment.words ?? [])
      .filter((word) => {
        const midpoint = (word.start + word.end) / 2;
        return (
          midpoint >= clipStart && midpoint < clipEnd
        );
      })
      .sort((a, b) => a.start - b.start);
    const words = speakerContext
      ? alignWordsToSpeakerContext(refinedWords, speakerContext)
      : refinedWords;
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

    const updates = originalChunks.flatMap((chunk, index) => {
      const bucketStart = index === 0 ? clipStart : chunk.startTimeSeconds;
      const bucketEnd = originalChunks[index + 1]?.startTimeSeconds ?? clipEnd;
      const chunkWords = words.filter((word) => {
        const midpoint = (word.start + word.end) / 2;
        return (
          midpoint >= bucketStart && midpoint < bucketEnd
        );
      });
      const previousRaw = objectValue(chunk.rawJson);
      const outsideWords = Array.isArray(previousRaw.words)
        ? (previousRaw.words as TranscriptWord[]).filter((word) => {
            const midpoint = (word.start + word.end) / 2;
            return midpoint < clipStart || midpoint >= clipEnd;
          }) : [];
      const combinedWords = [...outsideWords, ...chunkWords].sort((a, b) => a.start - b.start);
      const text = joinWords(combinedWords);
      return [
        prisma.transcriptChunk.update({
          where: { id: chunk.id },
          data: {
            text,
            startTimeSeconds: Math.min(chunk.startTimeSeconds, combinedWords[0]?.start ?? chunk.startTimeSeconds),
            endTimeSeconds: Math.max(chunk.endTimeSeconds, combinedWords[combinedWords.length - 1]?.end ?? chunk.endTimeSeconds),
            rawJson: toJsonValue({
              ...previousRaw,
              rawTranscript:
                previousRaw.rawTranscript ??
                previousRaw.canonicalTranscript ??
                chunk.text,
              canonicalTranscript: text,
              words: combinedWords,
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

    if (originalChunks.length === 0) {
      for (const segment of refined) {
        const segmentWords = (segment.words ?? []).filter((word) =>
          (word.start + word.end) / 2 >= clipStart &&
          (word.start + word.end) / 2 < clipEnd);
        if (!segmentWords.length) continue;
        updates.push(prisma.transcriptChunk.create({ data: {
          streamSessionId: clip.streamSessionId,
          startTimeSeconds: segmentWords[0]!.start,
          endTimeSeconds: segmentWords[segmentWords.length - 1]!.end,
          text: joinWords(segmentWords),
          rawJson: toJsonValue({ words: segmentWords, provider: "openai", model, timingModel }),
        } }));
      }
    }

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
            sourceKey,
            start: clipStart,
            end: clipEnd,
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
  clipSuggestionId: string,
  source?: RefinementSource
): Promise<ClipTranscriptRefinementResult> {
  const key = `${clipSuggestionId}:${source?.inputPath ?? "preview"}:${source?.startTimeSeconds ?? ""}:${source?.endTimeSeconds ?? ""}`;
  const existing = inFlight.get(key);
  if (existing) return existing;
  const promise = runRefinement(clipSuggestionId, source);
  inFlight.set(key, promise);
  try {
    return await promise;
  } finally {
    if (inFlight.get(key) === promise) {
      inFlight.delete(key);
    }
  }
}
