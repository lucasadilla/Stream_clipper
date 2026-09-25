import type {
  TranscriptSegmentWithMeta,
  TranscriptWord,
} from "@/lib/transcriptionTypes";

export interface DiarizationInterval {
  startTimeSeconds: number;
  endTimeSeconds: number;
  localSpeakerId?: string;
  confidence?: number;
  overlappingLocalSpeakerIds?: string[];
}

export interface SpeakerDiarizationResult {
  provider: string;
  model: string;
  intervals: DiarizationInterval[];
}

/** Boundary for hosted, CPU, or future isolated GPU diarization workers. */
export interface SpeakerDiarizationProvider {
  readonly id: string;
  readonly version: string;
  diarize(input: {
    audioPath: string;
    sourceOffsetSeconds: number;
    language?: string;
    expectedSpeakerCount?: { min?: number; max?: number };
  }): Promise<SpeakerDiarizationResult>;
}

export interface SpeakerEmbedding {
  localSpeakerId: string;
  vector: number[];
  confidence?: number;
}

/** Source-scoped voice embeddings used only to reconcile processing windows. */
export interface SpeakerEmbeddingProvider {
  readonly id: string;
  readonly version: string;
  embed(input: {
    audioPath: string;
    intervals: DiarizationInterval[];
  }): Promise<SpeakerEmbedding[]>;
}

/** Adapt the diarization already returned by Deepgram into the provider-neutral shape. */
export function diarizationFromTranscriptSegments(
  segments: TranscriptSegmentWithMeta[]
): SpeakerDiarizationResult {
  const model = segments.find((segment) => segment.model)?.model ?? "unknown";
  const words = segments.flatMap((segment) => segment.words ?? []);
  const grouped: DiarizationInterval[] = [];
  for (const word of words) {
    if (!word.speaker) continue;
    const previous = grouped.at(-1);
    if (
      previous?.localSpeakerId === word.speaker &&
      word.start - previous.endTimeSeconds <= 0.32
    ) {
      previous.endTimeSeconds = Math.max(previous.endTimeSeconds, word.end);
      previous.confidence = averageConfidence(
        previous.confidence,
        word.confidence
      );
    } else {
      grouped.push({
        startTimeSeconds: word.start,
        endTimeSeconds: word.end,
        localSpeakerId: word.speaker,
        confidence: word.confidence,
      });
    }
  }
  return {
    provider: segments.find((segment) => segment.provider)?.provider ?? "unknown",
    model,
    intervals: addOverlapMetadata(grouped),
  };
}

function averageConfidence(left?: number, right?: number): number | undefined {
  if (left == null) return right;
  if (right == null) return left;
  return (left + right) / 2;
}

function addOverlapMetadata(intervals: DiarizationInterval[]) {
  return intervals.map((interval) => ({
    ...interval,
    overlappingLocalSpeakerIds: [
      ...new Set(
        intervals
          .filter(
            (candidate) =>
              candidate !== interval &&
              candidate.localSpeakerId &&
              candidate.localSpeakerId !== interval.localSpeakerId &&
              candidate.startTimeSeconds < interval.endTimeSeconds &&
              candidate.endTimeSeconds > interval.startTimeSeconds
          )
          .map((candidate) => candidate.localSpeakerId!)
      ),
    ],
  }));
}

export function wordsForLocalSpeaker(
  words: TranscriptWord[],
  localSpeakerId: string
) {
  return words.filter((word) => word.speaker === localSpeakerId);
}
