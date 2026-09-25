import { createHash, randomUUID } from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { toJsonValue } from "@/lib/utils";
import {
  parseSpeakerContext,
  resolveSpeakerContext,
  speakerColorForIndex,
  transcriptWordsFromRawJson,
  type SpeakerContext,
  type SpeakerCorrection,
  type SpeakerIdentity,
  type SpeakerTranscriptChunk,
  type SpeakerVisibility,
} from "@/lib/speakerContext";
import type { AudioVisualSpeakerMatch } from "@/lib/audioVisualSpeakerMatcher";

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function withSpeakerContext(metadataJson: unknown, context: SpeakerContext) {
  return { ...objectValue(metadataJson), speakerContext: context };
}

function cacheKeyForChunks(chunks: SpeakerTranscriptChunk[]): string {
  const hash = createHash("sha256");
  for (const chunk of chunks) {
    const raw = objectValue(chunk.rawJson);
    hash.update(chunk.id);
    hash.update(`|${chunk.startTimeSeconds}|${chunk.endTimeSeconds}|${chunk.text}|`);
    hash.update(
      JSON.stringify({
        provider: raw.provider,
        model: raw.model,
        segmentStart: raw.segmentStart,
        segmentEnd: raw.segmentEnd,
        speakerEmbeddings: raw.speakerEmbeddings,
        words: transcriptWordsFromRawJson(raw).map((word) => ({
          start: word.start,
          end: word.end,
          word: word.word,
          speaker: word.speaker,
          confidence: word.confidence,
        })),
      })
    );
  }
  return hash.digest("hex").slice(0, 24);
}

export async function readSpeakerContext(
  streamSessionId: string
): Promise<SpeakerContext | null> {
  const session = await prisma.streamSession.findUnique({
    where: { id: streamSessionId },
    select: { metadataJson: true },
  });
  return session ? parseSpeakerContext(session.metadataJson) : null;
}

/**
 * Build and cache one canonical source-level context. This reuses transcript
 * diarization and only updates chunks whose stable word attribution changed.
 */
export async function ensureSpeakerContext(
  streamSessionId: string,
  options: { force?: boolean } = {}
): Promise<SpeakerContext> {
  const [session, chunks] = await Promise.all([
    prisma.streamSession.findUnique({
      where: { id: streamSessionId },
      select: { metadataJson: true },
    }),
    prisma.transcriptChunk.findMany({
      where: { streamSessionId },
      orderBy: { startTimeSeconds: "asc" },
      select: {
        id: true,
        startTimeSeconds: true,
        endTimeSeconds: true,
        text: true,
        rawJson: true,
      },
    }),
  ]);
  if (!session) throw new Error("Session not found");

  const existing = parseSpeakerContext(session.metadataJson);
  const cacheKey = cacheKeyForChunks(chunks);
  if (!options.force && existing?.cacheKey === cacheKey) return existing;

  const resolved = resolveSpeakerContext({
    sourceSessionId: streamSessionId,
    cacheKey,
    chunks,
    existing,
  });
  const updates = chunks.flatMap((chunk) => {
    const words = resolved.wordsByChunkId.get(chunk.id);
    if (!words?.length) return [];
    const raw = objectValue(chunk.rawJson);
    const previous = JSON.stringify(transcriptWordsFromRawJson(raw));
    const next = JSON.stringify(words);
    if (previous === next) return [];
    return [{ id: chunk.id, rawJson: toJsonValue({ ...raw, words }) }];
  });
  await prisma.$transaction(async (tx) => {
    await Promise.all(
      updates.map((update) =>
        tx.transcriptChunk.update({
          where: { id: update.id },
          data: { rawJson: update.rawJson },
        })
      )
    );
    const latest = await tx.streamSession.findUnique({
      where: { id: streamSessionId },
      select: { metadataJson: true },
    });
    if (!latest) throw new Error("Session not found");
    await tx.streamSession.update({
      where: { id: streamSessionId },
      data: {
        metadataJson: toJsonValue(
          withSpeakerContext(latest.metadataJson, resolved.context)
        ),
      },
    });
  });
  return resolved.context;
}

async function mutateSpeakerContext(
  streamSessionId: string,
  mutate: (context: SpeakerContext) => SpeakerContext
): Promise<SpeakerContext> {
  await ensureSpeakerContext(streamSessionId);
  return prisma.$transaction(async (tx) => {
    const session = await tx.streamSession.findUnique({
      where: { id: streamSessionId },
      select: { metadataJson: true },
    });
    if (!session) throw new Error("Session not found");
    const current = parseSpeakerContext(session.metadataJson);
    if (!current) throw new Error("Speaker context is unavailable");
    const next = mutate(current);
    await tx.streamSession.update({
      where: { id: streamSessionId },
      data: {
        metadataJson: toJsonValue(withSpeakerContext(session.metadataJson, next)),
      },
    });
    return next;
  });
}

function correction(
  type: SpeakerCorrection["type"],
  speakerId: string,
  details?: Record<string, unknown>
): SpeakerCorrection {
  return { type, speakerId, at: new Date().toISOString(), ...(details ? { details } : {}) };
}

export async function updateSpeakerIdentity(
  streamSessionId: string,
  speakerId: string,
  patch: Partial<
    Pick<
      SpeakerIdentity,
      | "displayName"
      | "color"
      | "visibility"
      | "faceTrackId"
      | "faceMappingConfidence"
    >
  >
): Promise<SpeakerContext> {
  return mutateSpeakerContext(streamSessionId, (context) => {
    const speakers = context.speakers.map((speaker) => {
      if (speaker.id !== speakerId) return speaker;
      return {
        ...speaker,
        ...(patch.displayName !== undefined
          ? { displayName: patch.displayName.trim() || undefined }
          : {}),
        ...(patch.color && /^#[0-9a-f]{6}$/i.test(patch.color)
          ? { color: patch.color.toUpperCase() }
          : {}),
        ...(patch.visibility ? { visibility: patch.visibility } : {}),
        ...(patch.faceTrackId !== undefined
          ? { faceTrackId: patch.faceTrackId || undefined }
          : {}),
        ...(patch.faceMappingConfidence !== undefined
          ? {
              faceMappingConfidence: Math.min(
                1,
                Math.max(0, patch.faceMappingConfidence)
              ),
            }
          : {}),
      };
    });
    if (!speakers.some((speaker) => speaker.id === speakerId)) {
      throw new Error("Speaker not found");
    }
    const events: SpeakerCorrection[] = [];
    if (patch.displayName !== undefined) {
      events.push(correction("speaker_name_changed", speakerId, { value: patch.displayName }));
    }
    if (patch.color !== undefined) {
      events.push(correction("speaker_color_changed", speakerId, { value: patch.color }));
    }
    if (patch.faceTrackId !== undefined || patch.visibility !== undefined) {
      events.push(
        correction("face_speaker_mapping_corrected", speakerId, {
          faceTrackId: patch.faceTrackId,
          visibility: patch.visibility,
        })
      );
    }
    return {
      ...context,
      updatedAt: new Date().toISOString(),
      speakers,
      corrections: [...context.corrections, ...events],
    };
  });
}

export async function mergeSpeakerIdentities(
  streamSessionId: string,
  sourceSpeakerId: string,
  targetSpeakerId: string
): Promise<SpeakerContext> {
  if (sourceSpeakerId === targetSpeakerId) {
    throw new Error("Choose two different speakers to merge");
  }
  const context = await mutateSpeakerContext(streamSessionId, (current) => {
    const source = current.speakers.find((speaker) => speaker.id === sourceSpeakerId);
    const target = current.speakers.find((speaker) => speaker.id === targetSpeakerId);
    if (!source || !target) throw new Error("Speaker not found");
    const speakers = current.speakers
      .filter((speaker) => speaker.id !== sourceSpeakerId)
      .map((speaker, index) =>
        speaker.id === targetSpeakerId
          ? {
              ...speaker,
              index,
              color: speaker.color || speakerColorForIndex(index),
              providerAliases: [
                ...speaker.providerAliases,
                ...source.providerAliases.filter(
                  (alias) =>
                    !speaker.providerAliases.some(
                      (existing) =>
                        existing.provider === alias.provider &&
                        existing.windowKey === alias.windowKey &&
                        existing.localSpeakerId === alias.localSpeakerId
                    )
                ),
              ],
            }
          : { ...speaker, index }
      );
    const intervals = current.intervals.map((interval) => {
      const speakerIds = [...new Set(
        interval.speakerIds.map((id) => (id === sourceSpeakerId ? targetSpeakerId : id))
      )];
      return {
        ...interval,
        speakerIds,
        primarySpeakerId:
          interval.primarySpeakerId === sourceSpeakerId
            ? targetSpeakerId
            : interval.primarySpeakerId,
        overlapping: speakerIds.length > 1,
      };
    });
    return {
      ...current,
      updatedAt: new Date().toISOString(),
      speakers,
      intervals,
      corrections: [
        ...current.corrections,
        correction("speaker_identity_merged", targetSpeakerId, { sourceSpeakerId }),
      ],
    };
  });

  const chunks = await prisma.transcriptChunk.findMany({
    where: { streamSessionId },
    select: { id: true, rawJson: true },
  });
  const updates = chunks.flatMap((chunk) => {
    const raw = objectValue(chunk.rawJson);
    const words = transcriptWordsFromRawJson(raw);
    let changed = false;
    const nextWords = words.map((word) => {
      if (word.speakerId !== sourceSpeakerId) return word;
      changed = true;
      return {
        ...word,
        speakerId: targetSpeakerId,
        speakerConfidence: 1,
        speakerAssignmentSource: "creator_override" as const,
      };
    });
    return changed
      ? [
          prisma.transcriptChunk.update({
            where: { id: chunk.id },
            data: { rawJson: toJsonValue({ ...raw, words: nextWords }) },
          }),
        ]
      : [];
  });
  if (updates.length) await prisma.$transaction(updates);
  return context;
}

/** Persist only strong automatic matches; creator corrections always win. */
export async function applyAutomaticSpeakerFaceMappings(
  streamSessionId: string,
  matches: AudioVisualSpeakerMatch[]
): Promise<SpeakerContext> {
  if (matches.length === 0) {
    return (await readSpeakerContext(streamSessionId)) ??
      ensureSpeakerContext(streamSessionId);
  }
  return mutateSpeakerContext(streamSessionId, (context) => {
    const manuallyCorrected = new Set(
      context.corrections
        .filter((item) => item.type === "face_speaker_mapping_corrected")
        .map((item) => item.speakerId)
    );
    const bySpeaker = new Map(matches.map((match) => [match.speakerId, match]));
    const speakers = context.speakers.map((speaker) => {
      if (manuallyCorrected.has(speaker.id)) return speaker;
      const match = bySpeaker.get(speaker.id);
      if (!match || match.confidence < (speaker.faceMappingConfidence ?? 0)) {
        return speaker;
      }
      return {
        ...speaker,
        visibility: "visible" as const,
        faceTrackId: match.faceTrackId,
        faceMappingConfidence: match.confidence,
      };
    });
    return { ...context, speakers, updatedAt: new Date().toISOString() };
  });
}

export async function correctSpeakerRange(
  streamSessionId: string,
  input: {
    startTimeSeconds: number;
    endTimeSeconds: number;
    speakerId: string;
  }
): Promise<SpeakerContext> {
  if (
    !Number.isFinite(input.startTimeSeconds) ||
    !Number.isFinite(input.endTimeSeconds) ||
    input.endTimeSeconds <= input.startTimeSeconds
  ) {
    throw new Error("A valid caption range is required");
  }
  const marked = await mutateSpeakerContext(streamSessionId, (context) => {
    if (!context.speakers.some((speaker) => speaker.id === input.speakerId)) {
      throw new Error("Speaker not found");
    }
    return {
      ...context,
      updatedAt: new Date().toISOString(),
      corrections: [
        ...context.corrections,
        correction("caption_speaker_corrected", input.speakerId, {
          startTimeSeconds: input.startTimeSeconds,
          endTimeSeconds: input.endTimeSeconds,
        }),
      ],
    };
  });
  const chunks = await prisma.transcriptChunk.findMany({
    where: {
      streamSessionId,
      startTimeSeconds: { lt: input.endTimeSeconds },
      endTimeSeconds: { gt: input.startTimeSeconds },
    },
    select: { id: true, rawJson: true },
  });
  const updates: Prisma.PrismaPromise<unknown>[] = [];
  for (const chunk of chunks) {
    const raw = objectValue(chunk.rawJson);
    const words = transcriptWordsFromRawJson(raw);
    let changed = false;
    const nextWords = words.map((word) => {
      const midpoint = (word.start + word.end) / 2;
      if (
        midpoint < input.startTimeSeconds ||
        midpoint >= input.endTimeSeconds
      ) {
        return word;
      }
      changed = true;
      return {
        ...word,
        speakerId: input.speakerId,
        speakerConfidence: 1,
        speakerAssignmentSource: "creator_override" as const,
      };
    });
    if (changed) {
      updates.push(
        prisma.transcriptChunk.update({
          where: { id: chunk.id },
          data: { rawJson: toJsonValue({ ...raw, words: nextWords }) },
        })
      );
    }
  }
  if (updates.length) await prisma.$transaction(updates);
  if (!updates.length) return marked;
  return ensureSpeakerContext(streamSessionId, { force: true });
}

export async function splitSpeakerRange(
  streamSessionId: string,
  input: {
    startTimeSeconds: number;
    endTimeSeconds: number;
    sourceSpeakerId: string;
  }
): Promise<SpeakerContext> {
  const newSpeakerId = `speaker_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  await mutateSpeakerContext(streamSessionId, (context) => {
    const source = context.speakers.find(
      (speaker) => speaker.id === input.sourceSpeakerId
    );
    if (!source) throw new Error("Speaker not found");
    const index = context.speakers.length;
    return {
      ...context,
      updatedAt: new Date().toISOString(),
      speakers: [
        ...context.speakers,
        {
          id: newSpeakerId,
          index,
          color: speakerColorForIndex(index),
          visibility: "unknown",
          confidence: 1,
          providerAliases: [],
        },
      ],
      corrections: [
        ...context.corrections,
        correction("speaker_identity_split", newSpeakerId, {
          sourceSpeakerId: input.sourceSpeakerId,
          startTimeSeconds: input.startTimeSeconds,
          endTimeSeconds: input.endTimeSeconds,
        }),
      ],
    };
  });
  return correctSpeakerRange(streamSessionId, {
    startTimeSeconds: input.startTimeSeconds,
    endTimeSeconds: input.endTimeSeconds,
    speakerId: newSpeakerId,
  });
}

export function isSpeakerVisibility(value: unknown): value is SpeakerVisibility {
  return value === "visible" || value === "offscreen" || value === "unknown";
}
