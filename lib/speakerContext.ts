import type { TranscriptWord } from "@/lib/transcriptionTypes";

export const SPEAKER_CONTEXT_VERSION = "speaker-context-v1" as const;
export const SPEAKER_IDENTITY_RESOLVER_VERSION = "speaker-identity-v1" as const;
export const SPEAKER_CAPTION_PALETTE_VERSION = "clipper-speakers-v1" as const;

/** Muted, high-luminance colors that remain readable with Clipper's outline. */
export const SPEAKER_CAPTION_COLORS = [
  "#FFF4D6", // warm ivory
  "#A7F3D0", // signal green
  "#FDE68A", // muted gold
  "#DDD6FE", // soft lavender
  "#BAE6FD", // sky blue
  "#FDA4AF", // coral
  "#C7D2FE", // periwinkle
  "#FBCFE8", // rose
] as const;

export type SpeakerVisibility = "visible" | "offscreen" | "unknown";

export interface SpeakerProviderAlias {
  provider: string;
  /** A provider-local ID. It is only meaningful inside `windowKey`. */
  localSpeakerId: string;
  windowKey: string;
  confidence: number;
}

export interface SpeakerIdentity {
  id: string;
  index: number;
  displayName?: string;
  color: string;
  visibility: SpeakerVisibility;
  confidence: number;
  faceTrackId?: string;
  faceMappingConfidence?: number;
  providerAliases: SpeakerProviderAlias[];
  /** Optional source-scoped acoustic centroid; never reused across creators. */
  voiceEmbedding?: number[];
  embeddingSamples?: number;
}

export interface SpeakerActivityInterval {
  /** Absolute source time. */
  startTimeSeconds: number;
  /** Absolute source time. */
  endTimeSeconds: number;
  speakerIds: string[];
  primarySpeakerId?: string;
  confidence: number;
  overlapping: boolean;
  source: "provider_diarization" | "word_alignment" | "creator_override";
}

export type SpeakerCorrectionType =
  | "speaker_assignment_corrected"
  | "speaker_identity_merged"
  | "speaker_identity_split"
  | "speaker_name_changed"
  | "speaker_color_changed"
  | "face_speaker_mapping_corrected"
  | "caption_speaker_corrected";

export interface SpeakerCorrection {
  type: SpeakerCorrectionType;
  speakerId: string;
  at: string;
  details?: Record<string, unknown>;
}

export interface SpeakerContext {
  version: typeof SPEAKER_CONTEXT_VERSION;
  identityResolverVersion: typeof SPEAKER_IDENTITY_RESOLVER_VERSION;
  paletteVersion: typeof SPEAKER_CAPTION_PALETTE_VERSION;
  sourceSessionId: string;
  cacheKey: string;
  updatedAt: string;
  speakers: SpeakerIdentity[];
  intervals: SpeakerActivityInterval[];
  corrections: SpeakerCorrection[];
  models: {
    diarizationProviders: string[];
    identityResolver: typeof SPEAKER_IDENTITY_RESOLVER_VERSION;
  };
  metrics: {
    totalWords: number;
    attributedWords: number;
    unresolvedWords: number;
    overlapSeconds: number;
  };
}

export interface SpeakerAwareWord extends TranscriptWord {
  /** Stable source-level ID, independent of a display name. */
  speakerId?: string;
  speakerConfidence?: number;
  overlappingSpeakerIds?: string[];
  alignmentConfidence?: number;
  speakerAssignmentSource?: "provider" | "word_alignment" | "creator_override";
}

export interface SpeakerTranscriptChunk {
  id: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  text: string;
  rawJson?: unknown;
}

export interface SpeakerResolutionResult {
  context: SpeakerContext;
  wordsByChunkId: Map<string, SpeakerAwareWord[]>;
}

type WindowCluster = {
  key: string;
  windowKey: string;
  provider: string;
  localSpeakerId: string;
  first: number;
  last: number;
  words: Array<{ chunkId: string; wordIndex: number; word: SpeakerAwareWord }>;
  embedding?: number[];
};

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function numericVector(value: unknown): number[] | undefined {
  if (!Array.isArray(value) || value.length < 2) return undefined;
  const vector = value.filter(finite);
  return vector.length === value.length ? vector : undefined;
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length === 0) return -1;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index]! * right[index]!;
    leftNorm += left[index]! ** 2;
    rightNorm += right[index]! ** 2;
  }
  if (leftNorm <= 1e-9 || rightNorm <= 1e-9) return -1;
  return dot / Math.sqrt(leftNorm * rightNorm);
}

function mergeEmbedding(
  current: number[] | undefined,
  incoming: number[],
  samples: number
): number[] {
  if (!current || current.length !== incoming.length) return [...incoming];
  return current.map(
    (value, index) => (value * samples + incoming[index]!) / (samples + 1)
  );
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function speakerColorForIndex(index: number): string {
  return SPEAKER_CAPTION_COLORS[
    Math.abs(Math.trunc(index)) % SPEAKER_CAPTION_COLORS.length
  ]!;
}

export function speakerColorForId(speakerId: string): string {
  return speakerColorForIndex(fnv1a(speakerId));
}

export function speakerDisplayName(
  speaker: Pick<SpeakerIdentity, "index" | "displayName">
): string {
  return speaker.displayName?.trim() || `Speaker ${speaker.index + 1}`;
}

function parseWord(value: unknown): SpeakerAwareWord | null {
  const raw = objectValue(value);
  if (!finite(raw.start) || !finite(raw.end) || raw.end <= raw.start) return null;
  if (typeof raw.word !== "string" || !raw.word.trim()) return null;
  return {
    start: raw.start,
    end: raw.end,
    word: raw.word,
    ...(finite(raw.confidence) ? { confidence: clamp(raw.confidence) } : {}),
    ...(typeof raw.speaker === "string" || typeof raw.speaker === "number"
      ? { speaker: String(raw.speaker) }
      : {}),
    ...(typeof raw.speakerId === "string" && raw.speakerId
      ? { speakerId: raw.speakerId }
      : {}),
    ...(finite(raw.speakerConfidence)
      ? { speakerConfidence: clamp(raw.speakerConfidence) }
      : {}),
    ...(Array.isArray(raw.overlappingSpeakerIds)
      ? {
          overlappingSpeakerIds: raw.overlappingSpeakerIds.filter(
            (id): id is string => typeof id === "string" && id.length > 0
          ),
        }
      : {}),
    ...(finite(raw.alignmentConfidence)
      ? { alignmentConfidence: clamp(raw.alignmentConfidence) }
      : {}),
    ...(raw.speakerAssignmentSource === "creator_override" ||
    raw.speakerAssignmentSource === "word_alignment" ||
    raw.speakerAssignmentSource === "provider"
      ? { speakerAssignmentSource: raw.speakerAssignmentSource }
      : {}),
  };
}

export function transcriptWordsFromRawJson(value: unknown): SpeakerAwareWord[] {
  const words = objectValue(value).words;
  return Array.isArray(words)
    ? words.flatMap((word) => {
        const parsed = parseWord(word);
        return parsed ? [parsed] : [];
      })
    : [];
}

function windowIdentity(
  chunk: SpeakerTranscriptChunk,
  raw: Record<string, unknown>
): { provider: string; windowKey: string } {
  const provider = typeof raw.provider === "string" ? raw.provider : "unknown";
  const start = finite(raw.segmentStart) ? raw.segmentStart : chunk.startTimeSeconds;
  const end = finite(raw.segmentEnd) ? raw.segmentEnd : chunk.endTimeSeconds;
  return { provider, windowKey: `${start.toFixed(3)}:${end.toFixed(3)}` };
}

function normalizeSpeaker(value: unknown, fallbackIndex: number): SpeakerIdentity | null {
  const raw = objectValue(value);
  if (typeof raw.id !== "string" || !raw.id) return null;
  const aliases = Array.isArray(raw.providerAliases)
    ? raw.providerAliases.flatMap((alias) => {
        const item = objectValue(alias);
        if (
          typeof item.provider !== "string" ||
          typeof item.localSpeakerId !== "string" ||
          typeof item.windowKey !== "string"
        ) {
          return [];
        }
        return [{
          provider: item.provider,
          localSpeakerId: item.localSpeakerId,
          windowKey: item.windowKey,
          confidence: finite(item.confidence) ? clamp(item.confidence) : 0.5,
        }];
      })
    : [];
  const index = finite(raw.index) ? Math.max(0, Math.trunc(raw.index)) : fallbackIndex;
  return {
    id: raw.id,
    index,
    ...(typeof raw.displayName === "string" && raw.displayName.trim()
      ? { displayName: raw.displayName.trim() }
      : {}),
    color:
      typeof raw.color === "string" && /^#[0-9a-f]{6}$/i.test(raw.color)
        ? raw.color.toUpperCase()
        : speakerColorForIndex(index),
    visibility:
      raw.visibility === "visible" || raw.visibility === "offscreen"
        ? raw.visibility
        : "unknown",
    confidence: finite(raw.confidence) ? clamp(raw.confidence) : 0.5,
    ...(typeof raw.faceTrackId === "string" && raw.faceTrackId
      ? { faceTrackId: raw.faceTrackId }
      : {}),
    ...(finite(raw.faceMappingConfidence)
      ? { faceMappingConfidence: clamp(raw.faceMappingConfidence) }
      : {}),
    providerAliases: aliases,
    ...(numericVector(raw.voiceEmbedding)
      ? { voiceEmbedding: numericVector(raw.voiceEmbedding) }
      : {}),
    ...(finite(raw.embeddingSamples)
      ? { embeddingSamples: Math.max(1, Math.trunc(raw.embeddingSamples)) }
      : {}),
  };
}

export function parseSpeakerContext(value: unknown): SpeakerContext | null {
  const raw = objectValue(value);
  const nested = raw.speakerContext ? objectValue(raw.speakerContext) : raw;
  if (
    nested.version !== SPEAKER_CONTEXT_VERSION ||
    typeof nested.sourceSessionId !== "string"
  ) {
    return null;
  }
  const speakers = Array.isArray(nested.speakers)
    ? nested.speakers.flatMap((speaker, index) => {
        const parsed = normalizeSpeaker(speaker, index);
        return parsed ? [parsed] : [];
      })
    : [];
  const validIds = new Set(speakers.map((speaker) => speaker.id));
  const intervals = Array.isArray(nested.intervals)
    ? nested.intervals.flatMap((interval) => {
        const item = objectValue(interval);
        if (!finite(item.startTimeSeconds) || !finite(item.endTimeSeconds)) return [];
        const speakerIds = Array.isArray(item.speakerIds)
          ? item.speakerIds.filter(
              (id): id is string => typeof id === "string" && validIds.has(id)
            )
          : [];
        if (speakerIds.length === 0 || item.endTimeSeconds <= item.startTimeSeconds) {
          return [];
        }
        return [{
          startTimeSeconds: item.startTimeSeconds,
          endTimeSeconds: item.endTimeSeconds,
          speakerIds,
          ...(typeof item.primarySpeakerId === "string" &&
          speakerIds.includes(item.primarySpeakerId)
            ? { primarySpeakerId: item.primarySpeakerId }
            : {}),
          confidence: finite(item.confidence) ? clamp(item.confidence) : 0.5,
          overlapping: speakerIds.length > 1,
          source: (
            item.source === "creator_override" || item.source === "word_alignment"
              ? item.source
              : "provider_diarization"
          ) as SpeakerActivityInterval["source"],
        }];
      })
    : [];
  const corrections = Array.isArray(nested.corrections)
    ? (nested.corrections as SpeakerCorrection[])
    : [];
  return {
    version: SPEAKER_CONTEXT_VERSION,
    identityResolverVersion: SPEAKER_IDENTITY_RESOLVER_VERSION,
    paletteVersion: SPEAKER_CAPTION_PALETTE_VERSION,
    sourceSessionId: nested.sourceSessionId,
    cacheKey: typeof nested.cacheKey === "string" ? nested.cacheKey : "",
    updatedAt:
      typeof nested.updatedAt === "string" ? nested.updatedAt : new Date(0).toISOString(),
    speakers,
    intervals,
    corrections,
    models: {
      diarizationProviders: Array.isArray(objectValue(nested.models).diarizationProviders)
        ? (objectValue(nested.models).diarizationProviders as unknown[]).filter(
            (provider): provider is string => typeof provider === "string"
          )
        : [],
      identityResolver: SPEAKER_IDENTITY_RESOLVER_VERSION,
    },
    metrics: {
      totalWords: finite(objectValue(nested.metrics).totalWords)
        ? Number(objectValue(nested.metrics).totalWords)
        : 0,
      attributedWords: finite(objectValue(nested.metrics).attributedWords)
        ? Number(objectValue(nested.metrics).attributedWords)
        : 0,
      unresolvedWords: finite(objectValue(nested.metrics).unresolvedWords)
        ? Number(objectValue(nested.metrics).unresolvedWords)
        : 0,
      overlapSeconds: finite(objectValue(nested.metrics).overlapSeconds)
        ? Number(objectValue(nested.metrics).overlapSeconds)
        : 0,
    },
  };
}

function timelineFromWords(
  words: SpeakerAwareWord[]
): SpeakerActivityInterval[] {
  const perSpeaker = new Map<string, Array<{ start: number; end: number; confidence: number }>>();
  for (const word of words) {
    if (!word.speakerId) continue;
    const entries = perSpeaker.get(word.speakerId) ?? [];
    const last = entries.at(-1);
    const confidence = word.speakerConfidence ?? 0.75;
    if (last && word.start - last.end <= 0.32) {
      last.end = Math.max(last.end, word.end);
      last.confidence = (last.confidence + confidence) / 2;
    } else {
      entries.push({ start: word.start, end: word.end, confidence });
    }
    perSpeaker.set(word.speakerId, entries);
  }

  const ranges = [...perSpeaker.entries()].flatMap(([speakerId, entries]) =>
    entries.map((entry) => ({ speakerId, ...entry }))
  );
  const boundaries = [...new Set(ranges.flatMap((range) => [range.start, range.end]))]
    .sort((left, right) => left - right);
  const intervals: SpeakerActivityInterval[] = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index]!;
    const end = boundaries[index + 1]!;
    if (end - start < 0.005) continue;
    const active = ranges.filter(
      (range) => range.start < end - 1e-6 && range.end > start + 1e-6
    );
    if (active.length === 0) continue;
    const ranked = [...active].sort((left, right) => right.confidence - left.confidence);
    const speakerIds = [...new Set(ranked.map((range) => range.speakerId))];
    const next: SpeakerActivityInterval = {
      startTimeSeconds: start,
      endTimeSeconds: end,
      speakerIds,
      primarySpeakerId: speakerIds[0],
      confidence: ranked.reduce((sum, range) => sum + range.confidence, 0) / ranked.length,
      overlapping: speakerIds.length > 1,
      source: "provider_diarization",
    };
    const previous = intervals.at(-1);
    if (
      previous &&
      previous.endTimeSeconds === next.startTimeSeconds &&
      previous.speakerIds.join("|") === next.speakerIds.join("|") &&
      previous.source === next.source
    ) {
      previous.endTimeSeconds = next.endTimeSeconds;
      previous.confidence = (previous.confidence + next.confidence) / 2;
    } else {
      intervals.push(next);
    }
  }
  return intervals;
}

function clusterConfidence(
  cluster: WindowCluster,
  resolution: "exact" | "embedding" | "continuity" | "new"
) {
  const wordConfidence = cluster.words
    .map(({ word }) => word.confidence)
    .filter((value): value is number => finite(value));
  const asr = wordConfidence.length
    ? wordConfidence.reduce((sum, value) => sum + value, 0) / wordConfidence.length
    : 0.82;
  const identity =
    resolution === "exact"
      ? 0.94
      : resolution === "embedding"
        ? 0.9
        : resolution === "continuity"
          ? 0.72
          : 0.68;
  return clamp(asr * 0.35 + identity * 0.65);
}

/**
 * Reconcile provider-local IDs into source-level identities. Exact stored aliases
 * win. Across new windows, identity is reused only at a tight conversational seam;
 * provider label numbers alone never imply that two people are the same.
 */
export function resolveSpeakerContext(input: {
  sourceSessionId: string;
  cacheKey: string;
  chunks: SpeakerTranscriptChunk[];
  existing?: SpeakerContext | null;
  now?: string;
}): SpeakerResolutionResult {
  const existing = input.existing;
  const speakers = (existing?.speakers ?? []).map((speaker) => ({
    ...speaker,
    providerAliases: speaker.providerAliases.map((alias) => ({ ...alias })),
  }));
  const wordsByChunkId = new Map<string, SpeakerAwareWord[]>();
  const clusters = new Map<string, WindowCluster>();

  for (const chunk of input.chunks) {
    const raw = objectValue(chunk.rawJson);
    const { provider, windowKey } = windowIdentity(chunk, raw);
    const speakerEmbeddings = objectValue(raw.speakerEmbeddings);
    const words = transcriptWordsFromRawJson(raw);
    wordsByChunkId.set(chunk.id, words);
    words.forEach((word, wordIndex) => {
      if (!word.speaker || word.speakerAssignmentSource === "creator_override") return;
      const key = `${provider}|${windowKey}|${word.speaker}`;
      const cluster = clusters.get(key) ?? {
        key,
        provider,
        windowKey,
        localSpeakerId: word.speaker,
        first: word.start,
        last: word.end,
        words: [],
        embedding: numericVector(speakerEmbeddings[word.speaker]),
      };
      cluster.first = Math.min(cluster.first, word.start);
      cluster.last = Math.max(cluster.last, word.end);
      cluster.words.push({ chunkId: chunk.id, wordIndex, word });
      clusters.set(key, cluster);
    });
  }

  const sortedClusters = [...clusters.values()].sort(
    (left, right) => left.first - right.first || left.localSpeakerId.localeCompare(right.localSpeakerId)
  );
  const assignments = new Map<string, { speaker: SpeakerIdentity; confidence: number }>();
  const lastSeen = new Map<string, number>();

  for (const speaker of speakers) {
    const relevantWords = [...wordsByChunkId.values()].flat().filter(
      (word) => word.speakerId === speaker.id
    );
    if (relevantWords.length) {
      lastSeen.set(speaker.id, Math.max(...relevantWords.map((word) => word.end)));
    }
  }

  const claimedInWindow = new Map<string, Set<string>>();
  for (const cluster of sortedClusters) {
    const aliasMatch = speakers.find((speaker) =>
      speaker.providerAliases.some(
        (alias) =>
          alias.provider === cluster.provider &&
          alias.windowKey === cluster.windowKey &&
          alias.localSpeakerId === cluster.localSpeakerId
      )
    );
    let selected = aliasMatch;
    let resolution: "exact" | "embedding" | "continuity" | "new" =
      aliasMatch ? "exact" : "new";

    if (!selected && cluster.embedding) {
      const acoustic = speakers
        .flatMap((speaker) => {
          if (!speaker.voiceEmbedding) return [];
          return [{
            speaker,
            similarity: cosineSimilarity(cluster.embedding!, speaker.voiceEmbedding),
          }];
        })
        .sort((left, right) => right.similarity - left.similarity);
      const best = acoustic[0];
      const runnerUp = acoustic[1];
      if (
        best &&
        best.similarity >= 0.84 &&
        (!runnerUp || best.similarity - runnerUp.similarity >= 0.045)
      ) {
        selected = best.speaker;
        resolution = "embedding";
      }
    }

    if (!selected) {
      const claimed = claimedInWindow.get(cluster.windowKey) ?? new Set<string>();
      const continuity = speakers
        .flatMap((speaker) => {
          if (claimed.has(speaker.id)) return [];
          const seen = lastSeen.get(speaker.id);
          if (!finite(seen)) return [];
          const gap = cluster.first - seen;
          if (gap < -0.25 || gap > 1.35) return [];
          const adjacentAlias = speaker.providerAliases.some(
            (alias) =>
              alias.provider === cluster.provider &&
              alias.localSpeakerId === cluster.localSpeakerId
          );
          return [{ speaker, gap, adjacentAlias }];
        })
        .sort(
          (left, right) =>
            Number(right.adjacentAlias) - Number(left.adjacentAlias) ||
            left.gap - right.gap
        );
      const best = continuity[0];
      const runnerUp = continuity[1];
      // Ambiguous seams remain separate. This is safer than inventing identity.
      if (
        best &&
        (!runnerUp || best.adjacentAlias || runnerUp.gap - best.gap >= 0.35)
      ) {
        selected = best.speaker;
        resolution = "continuity";
      }
    }

    if (!selected) {
      const index = speakers.length;
      selected = {
        id: `speaker_${fnv1a(`${input.sourceSessionId}|${cluster.key}`).toString(36)}`,
        index,
        color: speakerColorForIndex(index),
        visibility: "unknown",
        confidence: 0.68,
        providerAliases: [],
      };
      speakers.push(selected);
    }

    const confidence = clusterConfidence(cluster, resolution);
    if (cluster.embedding) {
      const samples = selected.embeddingSamples ?? 0;
      selected.voiceEmbedding = mergeEmbedding(
        selected.voiceEmbedding,
        cluster.embedding,
        samples
      );
      selected.embeddingSamples = samples + 1;
    }
    selected.confidence = Math.max(selected.confidence, confidence);
    if (
      !selected.providerAliases.some(
        (alias) =>
          alias.provider === cluster.provider &&
          alias.windowKey === cluster.windowKey &&
          alias.localSpeakerId === cluster.localSpeakerId
      )
    ) {
      selected.providerAliases.push({
        provider: cluster.provider,
        localSpeakerId: cluster.localSpeakerId,
        windowKey: cluster.windowKey,
        confidence,
      });
    }
    const claimed = claimedInWindow.get(cluster.windowKey) ?? new Set<string>();
    claimed.add(selected.id);
    claimedInWindow.set(cluster.windowKey, claimed);
    lastSeen.set(selected.id, Math.max(lastSeen.get(selected.id) ?? 0, cluster.last));
    assignments.set(cluster.key, { speaker: selected, confidence });
  }

  for (const cluster of sortedClusters) {
    const assignment = assignments.get(cluster.key);
    if (!assignment) continue;
    for (const entry of cluster.words) {
      const words = wordsByChunkId.get(entry.chunkId);
      const word = words?.[entry.wordIndex];
      if (!word) continue;
      word.speakerId = assignment.speaker.id;
      word.speakerConfidence = assignment.confidence;
      word.alignmentConfidence = word.confidence;
      word.speakerAssignmentSource = "provider";
    }
  }

  const allWords = [...wordsByChunkId.values()].flat().sort(
    (left, right) => left.start - right.start || left.end - right.end
  );
  for (const word of allWords) {
    if (!word.speakerId) continue;
    const overlapping = [...new Set(
      allWords
        .filter(
          (candidate) =>
            candidate.speakerId &&
            candidate.speakerId !== word.speakerId &&
            candidate.start < word.end - 0.015 &&
            candidate.end > word.start + 0.015
        )
        .map((candidate) => candidate.speakerId!)
    )];
    if (overlapping.length) word.overlappingSpeakerIds = overlapping;
  }

  const intervals = timelineFromWords(allWords);
  const attributedWords = allWords.filter((word) => word.speakerId).length;
  const context: SpeakerContext = {
    version: SPEAKER_CONTEXT_VERSION,
    identityResolverVersion: SPEAKER_IDENTITY_RESOLVER_VERSION,
    paletteVersion: SPEAKER_CAPTION_PALETTE_VERSION,
    sourceSessionId: input.sourceSessionId,
    cacheKey: input.cacheKey,
    updatedAt: input.now ?? new Date().toISOString(),
    speakers,
    intervals,
    corrections: existing?.corrections ?? [],
    models: {
      diarizationProviders: [...new Set(sortedClusters.map((cluster) => cluster.provider))],
      identityResolver: SPEAKER_IDENTITY_RESOLVER_VERSION,
    },
    metrics: {
      totalWords: allWords.length,
      attributedWords,
      unresolvedWords: allWords.length - attributedWords,
      overlapSeconds: intervals
        .filter((interval) => interval.overlapping)
        .reduce(
          (sum, interval) =>
            sum + interval.endTimeSeconds - interval.startTimeSeconds,
          0
        ),
    },
  };
  return { context, wordsByChunkId };
}

/** Assign refined/aligned words from the canonical speaker timeline. */
export function alignWordsToSpeakerContext(
  words: TranscriptWord[],
  context: SpeakerContext
): SpeakerAwareWord[] {
  return words.map((source) => {
    const word: SpeakerAwareWord = {
      ...source,
      alignmentConfidence: source.confidence,
    };
    if (
      source.speakerAssignmentSource === "creator_override" &&
      source.speakerId
    ) {
      return {
        ...word,
        speakerConfidence: 1,
        speakerAssignmentSource: "creator_override",
      };
    }
    const duration = Math.max(0.01, word.end - word.start);
    const candidates = context.intervals.flatMap((interval) => {
      const overlap = Math.max(
        0,
        Math.min(word.end, interval.endTimeSeconds) -
          Math.max(word.start, interval.startTimeSeconds)
      );
      if (overlap <= 0) return [];
      return interval.speakerIds.map((speakerId) => ({
        speakerId,
        score: (overlap / duration) * interval.confidence,
      }));
    });
    const totals = new Map<string, number>();
    for (const candidate of candidates) {
      totals.set(
        candidate.speakerId,
        (totals.get(candidate.speakerId) ?? 0) + candidate.score
      );
    }
    const ranked = [...totals.entries()].sort((left, right) => right[1] - left[1]);
    const best = ranked[0];
    const runnerUp = ranked[1];
    const confidence = best ? clamp(best[1]) : 0;
    if (best && confidence >= 0.45 && (!runnerUp || best[1] - runnerUp[1] >= 0.12)) {
      word.speakerId = best[0];
      word.speakerConfidence = confidence;
      word.speakerAssignmentSource = "word_alignment";
    } else {
      delete word.speakerId;
      word.speakerConfidence = confidence;
    }
    const overlapping = ranked
      .slice(best ? 1 : 0)
      .filter(([, score]) => score >= 0.25)
      .map(([speakerId]) => speakerId);
    if (overlapping.length) word.overlappingSpeakerIds = overlapping;
    return word;
  });
}

export function speakerAtTime(
  context: SpeakerContext | undefined,
  timestampSeconds: number
): SpeakerActivityInterval | undefined {
  return context?.intervals.find(
    (interval) =>
      timestampSeconds >= interval.startTimeSeconds &&
      timestampSeconds < interval.endTimeSeconds
  );
}

export function faceTrackForSpeaker(
  context: SpeakerContext | undefined,
  speakerId: string | undefined,
  minimumConfidence = 0.72
): string | undefined {
  if (!context || !speakerId) return undefined;
  const speaker = context.speakers.find((item) => item.id === speakerId);
  if (
    !speaker?.faceTrackId ||
    speaker.visibility !== "visible" ||
    (speaker.faceMappingConfidence ?? 0) < minimumConfidence
  ) {
    return undefined;
  }
  return speaker.faceTrackId;
}

export function remapSpeakerIntervalsToSequence(
  intervals: SpeakerActivityInterval[],
  segments: Array<{
    sourceStart: number;
    sourceEnd: number;
    playbackRate?: number;
  }>
): SpeakerActivityInterval[] {
  const output: SpeakerActivityInterval[] = [];
  let outputCursor = 0;
  for (const segment of segments) {
    const rate = Math.max(0.05, segment.playbackRate ?? 1);
    for (const interval of intervals) {
      const start = Math.max(interval.startTimeSeconds, segment.sourceStart);
      const end = Math.min(interval.endTimeSeconds, segment.sourceEnd);
      if (end <= start) continue;
      output.push({
        ...interval,
        startTimeSeconds: outputCursor + (start - segment.sourceStart) / rate,
        endTimeSeconds: outputCursor + (end - segment.sourceStart) / rate,
      });
    }
    outputCursor += (segment.sourceEnd - segment.sourceStart) / rate;
  }
  return output;
}
