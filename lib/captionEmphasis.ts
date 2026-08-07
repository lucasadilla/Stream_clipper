import type { CaptionCue } from "@/lib/captionTrack";

const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "because",
  "been",
  "before",
  "could",
  "does",
  "from",
  "have",
  "just",
  "like",
  "really",
  "that",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "very",
  "want",
  "were",
  "what",
  "when",
  "where",
  "which",
  "with",
  "would",
  "your",
]);

function cleanWord(word: string): string {
  return word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

function wordScore(word: string, index: number, total: number): number {
  const clean = cleanWord(word);
  if (!clean) return Number.NEGATIVE_INFINITY;
  const lower = clean.toLocaleLowerCase();
  let score = Math.min(8, clean.length);
  if (STOP_WORDS.has(lower)) score -= 6;
  if (/\d/.test(clean)) score += 2;
  if (/[!?]$/.test(word.trim())) score += 4;
  if (clean.length >= 7) score += 2;
  if (index === total - 1) score += 0.75;
  return score;
}

/** Select one meaningful word per cue for tasteful automatic emphasis. */
export function selectCaptionEmphasisWordIndex(words: string[]): number | null {
  if (words.length === 0) return null;
  let bestIndex = -1;
  let bestScore = Number.NEGATIVE_INFINITY;
  words.forEach((word, index) => {
    const score = wordScore(word, index, words.length);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  return bestIndex >= 0 ? bestIndex : null;
}

export interface DynamicPunchEvent {
  id: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  peakScale: number;
}

type PunchCue = Pick<
  CaptionCue,
  "id" | "startTimeSeconds" | "endTimeSeconds" | "text" | "words"
>;

/**
 * Build restrained punch-ins around emphasized words. Events are spaced so
 * the edit feels intentional instead of zooming on every caption.
 */
export function buildDynamicPunchEvents(
  cues: PunchCue[],
  minimumGapSeconds = 3.4
): DynamicPunchEvent[] {
  const events: DynamicPunchEvent[] = [];
  let lastStart = Number.NEGATIVE_INFINITY;

  for (const cue of cues) {
    const words = cue.words?.map((word) => word.word) ?? cue.text.split(/\s+/);
    const emphasisIndex = selectCaptionEmphasisWordIndex(words);
    const emphasizedWord =
      emphasisIndex != null ? cue.words?.[emphasisIndex] : undefined;
    const start = emphasizedWord
      ? Math.max(cue.startTimeSeconds, emphasizedWord.start)
      : cue.startTimeSeconds +
        Math.min(0.22, Math.max(0, cue.endTimeSeconds - cue.startTimeSeconds) * 0.15);

    if (start - lastStart < minimumGapSeconds) continue;
    const available = Math.max(0.35, cue.endTimeSeconds - start);
    const duration = Math.min(0.9, available);
    events.push({
      id: `${cue.id}-punch-${emphasisIndex ?? 0}`,
      startTimeSeconds: start,
      endTimeSeconds: start + duration,
      peakScale: 1.06,
    });
    lastStart = start;
  }

  return events;
}

export function activeDynamicPunchEvent(
  events: DynamicPunchEvent[],
  timeSeconds: number
): DynamicPunchEvent | null {
  return (
    events.find(
      (event) =>
        timeSeconds >= event.startTimeSeconds &&
        timeSeconds < event.endTimeSeconds
    ) ?? null
  );
}

