export type SpeechBoundaryChunk = {
  startTimeSeconds: number;
  endTimeSeconds: number;
  text: string;
};

export type CompleteClipBoundary = {
  start: number;
  end: number;
  adjusted: boolean;
  endingComplete: boolean;
};

const INCOMPLETE_ENDING = new Set([
  "a",
  "about",
  "actually",
  "an",
  "and",
  "are",
  "as",
  "at",
  "because",
  "but",
  "can",
  "could",
  "for",
  "from",
  "had",
  "has",
  "have",
  "if",
  "in",
  "into",
  "is",
  "just",
  "like",
  "of",
  "on",
  "or",
  "so",
  "that",
  "the",
  "then",
  "to",
  "was",
  "were",
  "when",
  "which",
  "while",
  "will",
  "with",
  "would",
]);

function cleanWords(text: string): string[] {
  return text
    .toLocaleLowerCase()
    .replace(/[^a-z0-9']+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/** Conservative signal that a transcript segment cannot be a natural ending. */
export function hasIncompleteSpeechEnding(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (/(?:\.{3,}|…|[,;:\-–—])\s*$/.test(trimmed)) return true;
  const words = cleanWords(trimmed);
  const last = words.at(-1);
  if (!last || INCOMPLETE_ENDING.has(last)) return true;

  const opens = (trimmed.match(/[([{]/g) ?? []).length;
  const closes = (trimmed.match(/[)\]}]/g) ?? []).length;
  return opens > closes;
}

/**
 * Snap an automatically selected range to transcript segments and extend a
 * dangling final clause through the next nearby segment. Visual-only moments
 * are left untouched because speech cannot be used to judge their boundary.
 */
export function refineClipToCompleteSpeech(options: {
  start: number;
  end: number;
  transcriptChunks: SpeechBoundaryChunk[];
  maximumDurationSeconds: number;
  postRollSeconds?: number;
}): CompleteClipBoundary {
  const originalStart = Math.max(0, options.start);
  const originalEnd = Math.max(originalStart, options.end);
  const chunks = options.transcriptChunks.filter(
    (chunk) =>
      chunk.text.trim().length > 0 &&
      chunk.endTimeSeconds > originalStart &&
      chunk.startTimeSeconds < originalEnd
  );
  if (chunks.length === 0) {
    return {
      start: originalStart,
      end: originalEnd,
      adjusted: false,
      endingComplete: true,
    };
  }

  const allChunks = options.transcriptChunks.filter(
    (chunk) => chunk.text.trim().length > 0
  );
  const first = chunks[0]!;
  let last = chunks.at(-1)!;
  const start = Math.max(0, Math.min(originalStart, first.startTimeSeconds - 0.15));
  const maximumEnd = start + Math.max(3, options.maximumDurationSeconds);
  let lastIndex = allChunks.indexOf(last);

  // A range ending inside a segment always includes that complete segment.
  // If its final clause is visibly dangling, include following speech until a
  // natural chunk boundary appears or the content-specific duration cap wins.
  while (
    hasIncompleteSpeechEnding(last.text) &&
    lastIndex >= 0 &&
    lastIndex + 1 < allChunks.length
  ) {
    const next = allChunks[lastIndex + 1]!;
    if (next.startTimeSeconds - last.endTimeSeconds > 3) break;
    if (next.endTimeSeconds > maximumEnd) break;
    last = next;
    lastIndex += 1;
  }

  const postRoll = Math.max(0, options.postRollSeconds ?? 0.35);
  const end = Math.min(maximumEnd, Math.max(originalEnd, last.endTimeSeconds + postRoll));
  const endingComplete =
    !hasIncompleteSpeechEnding(last.text) && end + 0.05 >= last.endTimeSeconds;

  return {
    start,
    end,
    adjusted:
      Math.abs(start - originalStart) > 0.05 ||
      Math.abs(end - originalEnd) > 0.05,
    endingComplete,
  };
}
