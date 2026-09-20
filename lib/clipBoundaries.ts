export type SpeechBoundaryChunk = {
  startTimeSeconds: number;
  endTimeSeconds: number;
  text: string;
  rawJson?: unknown;
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
  "your",
  "you're",
  "we're",
  "they're",
  "i'm",
  "i've",
  "we've",
  "they've",
  "this",
  "these",
  "those",
  "my",
  "our",
  "their",
]);

const DANGLING_PHRASE =
  /\b(?:even though|as long as|as soon as|in order to|rather than|due to|such as|for example|the fact that|the reason (?:is|was)|what I mean is|all you have to do is|the thing is|it turns out that)\s*$/i;
const DANGLING_AUXILIARY =
  /\b(?:I|you|we|they|he|she|it|that|this)\s+(?:am|is|are|was|were|have|has|had|do|does|did|can|could|will|would|should|might|must|want|need|think|know|feel|mean|guess|started|tried)\s*$/i;
const TERMINAL_PUNCTUATION = /[.!][)'\"]?\s*$/;
const QUESTION_ENDING = /\?[)'\"]?\s*$/;

function hasTerminalPunctuation(text: string): boolean {
  return TERMINAL_PUNCTUATION.test(text.trim());
}

type TimedSpeechWord = { word: string; start: number; end: number };

function timedWords(rawJson: unknown): TimedSpeechWord[] {
  if (!rawJson || typeof rawJson !== "object") return [];
  const words = (rawJson as { words?: unknown }).words;
  if (!Array.isArray(words)) return [];
  return words
    .flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const raw = entry as Record<string, unknown>;
      const word = typeof raw.word === "string" ? raw.word.trim() : "";
      if (
        !word ||
        typeof raw.start !== "number" ||
        !Number.isFinite(raw.start) ||
        typeof raw.end !== "number" ||
        !Number.isFinite(raw.end) ||
        raw.end <= raw.start
      ) {
        return [];
      }
      return [{ word, start: raw.start, end: raw.end }];
    })
    .sort((a, b) => a.start - b.start || a.end - b.end);
}

/** Split long provider chunks at word-level sentence endings and real pauses. */
function speechUnits(chunks: SpeechBoundaryChunk[]): SpeechBoundaryChunk[] {
  return chunks
    .flatMap((chunk) => {
      const words = timedWords(chunk.rawJson).filter(
        (word) =>
          word.end > chunk.startTimeSeconds - 0.25 &&
          word.start < chunk.endTimeSeconds + 0.25
      );
      if (words.length === 0) return [chunk];

      const units: SpeechBoundaryChunk[] = [];
      let group: TimedSpeechWord[] = [];
      const flush = () => {
        if (group.length === 0) return;
        units.push({
          startTimeSeconds: group[0]!.start,
          endTimeSeconds: group.at(-1)!.end,
          text: group.map((word) => word.word).join(" "),
        });
        group = [];
      };

      words.forEach((word, index) => {
        group.push(word);
        const next = words[index + 1];
        const pause = next ? next.start - word.end : 0;
        if (/[.!?][)'\"]?$/.test(word.word) || pause >= 1.05) flush();
      });
      flush();
      return units.length > 0 ? units : [chunk];
    })
    .filter((chunk) => chunk.endTimeSeconds > chunk.startTimeSeconds)
    .sort(
      (a, b) =>
        a.startTimeSeconds - b.startTimeSeconds ||
        a.endTimeSeconds - b.endTimeSeconds
    );
}

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
  if (DANGLING_PHRASE.test(trimmed) || DANGLING_AUXILIARY.test(trimmed)) {
    return true;
  }
  const words = cleanWords(trimmed);
  const last = words.at(-1);
  if (!last || INCOMPLETE_ENDING.has(last)) return true;

  const opens = (trimmed.match(/[([{]/g) ?? []).length;
  const closes = (trimmed.match(/[)\]}]/g) ?? []).length;
  return opens > closes;
}

/**
 * Whether the current utterance still needs following speech before it can be
 * used as an intentional clip ending. Short timing gaps are treated as one
 * continuous thought even when the transcription provider omitted punctuation.
 */
export function speechEndingNeedsContinuation(
  current: SpeechBoundaryChunk,
  next?: SpeechBoundaryChunk,
  options?: { requireSettledEnding?: boolean; pauseSeconds?: number }
): boolean {
  const text = current.text.trim();
  if (hasIncompleteSpeechEnding(text) || QUESTION_ENDING.test(text)) return true;

  const pauseSeconds = Math.max(0.35, options?.pauseSeconds ?? 1.05);
  if (next) {
    const gap = Math.max(0, next.startTimeSeconds - current.endTimeSeconds);
    // Punctuation is authoritative. Without it, nearby chunks are normally the
    // next part of the same sentence or answer and should travel together.
    return !hasTerminalPunctuation(text) && gap < pauseSeconds;
  }

  // At a live transcript frontier, a non-punctuated chunk may simply be the
  // partial hypothesis available right now. Wait for the next live pass.
  return Boolean(options?.requireSettledEnding && !hasTerminalPunctuation(text));
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
  requireSettledEnding?: boolean;
}): CompleteClipBoundary {
  const originalStart = Math.max(0, options.start);
  const originalEnd = Math.max(originalStart, options.end);
  const allChunks = speechUnits(options.transcriptChunks).filter(
    (chunk) => chunk.text.trim().length > 0
  );
  const chunks = allChunks
    .filter(
      (chunk) =>
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

  const first = chunks[0]!;
  let last = chunks.at(-1)!;
  const start = Math.max(0, Math.min(originalStart, first.startTimeSeconds - 0.15));
  const maximumEnd = start + Math.max(3, options.maximumDurationSeconds);
  let lastIndex = allChunks.indexOf(last);

  // A range ending inside a segment always includes that complete segment.
  // Continue through connected speech, unresolved questions and dependent
  // clauses until punctuation or a real pause creates an intentional exit.
  while (
    speechEndingNeedsContinuation(last, allChunks[lastIndex + 1], {
      requireSettledEnding: options.requireSettledEnding,
    }) &&
    lastIndex >= 0 &&
    lastIndex + 1 < allChunks.length
  ) {
    const next = allChunks[lastIndex + 1]!;
    if (next.startTimeSeconds - last.endTimeSeconds > 3) break;
    if (next.endTimeSeconds > maximumEnd) break;
    last = next;
    lastIndex += 1;
  }

  const next = allChunks[lastIndex + 1];
  const postRoll = Math.max(0, options.postRollSeconds ?? 0.35);
  const safePostRoll = next
    ? Math.min(
        postRoll,
        Math.max(0.08, next.startTimeSeconds - last.endTimeSeconds - 0.05)
      )
    : postRoll;
  const end = Math.min(
    maximumEnd,
    Math.max(originalEnd, last.endTimeSeconds + safePostRoll)
  );
  const endingComplete =
    !speechEndingNeedsContinuation(last, next, {
      requireSettledEnding: options.requireSettledEnding,
    }) && end + 0.05 >= last.endTimeSeconds;

  return {
    start,
    end,
    adjusted:
      Math.abs(start - originalStart) > 0.05 ||
      Math.abs(end - originalEnd) > 0.05,
    endingComplete,
  };
}
