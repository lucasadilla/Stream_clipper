import type { RenderFormat } from "@/lib/renderFormat";
import {
  isValidCaptionText,
  maxCharsPerCaptionLine,
  sanitizeCaptionText,
  wrapCaptionText,
} from "@/lib/captionStyles";
import { distributeTextAcrossSpan } from "@/lib/transcriptTiming";
import {
  directCaptionTrack,
  type CaptionCueDirection,
} from "@/lib/captionDirector";

export interface CaptionWord {
  start: number;
  end: number;
  word: string;
}

export interface CaptionCue {
  id: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  text: string;
  /** Per-word timings when available (for karaoke preview/export). */
  words?: CaptionWord[];
  /** Editorial role, emphasis, and motion shared by preview and export. */
  direction?: CaptionCueDirection;
}

/**
 * Return authoritative word timings, or derive stable proportional timings
 * when a transcript provider only supplied cue-level timestamps. This keeps
 * word reveal available without pretending the estimated timings are STT data.
 */
export function captionWordsForAnimation(
  cue: Pick<
    CaptionCue,
    "startTimeSeconds" | "endTimeSeconds" | "text" | "words"
  >
): CaptionWord[] {
  const timed = (cue.words ?? []).filter(
    (word) =>
      Number.isFinite(word.start) &&
      Number.isFinite(word.end) &&
      word.end > word.start &&
      word.word.trim().length > 0
  );
  if (timed.length > 0) return timed;

  const tokens = cue.text.replace(/\n/g, " ").split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];

  const start = Math.max(0, cue.startTimeSeconds);
  const end = Math.max(start + 0.1, cue.endTimeSeconds);
  const weights = tokens.map((token) => {
    const spokenLength = token.replace(/[^\p{L}\p{N}'’-]/gu, "").length;
    const punctuationPause = /[.!?]["')\]]?$/.test(token)
      ? 2
      : /[,;:]["')\]]?$/.test(token)
        ? 1
        : 0;
    return Math.max(1, spokenLength) + punctuationPause;
  });
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const span = end - start;
  let cursor = start;

  return tokens.map((word, index) => {
    const wordEnd =
      index === tokens.length - 1
        ? end
        : cursor + span * (weights[index]! / totalWeight);
    const timedWord = { word, start: cursor, end: wordEnd };
    cursor = wordEnd;
    return timedWord;
  });
}

export interface TranscriptChunkInput {
  id: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  text: string;
  rawJson?: unknown;
}

interface WhisperWord {
  start: number;
  end: number;
  word: string;
}

/** True when any chunk carries usable word-level timestamps. */
export function transcriptHasWordTimings(
  chunks: TranscriptChunkInput[]
): boolean {
  return chunks.some((chunk) => {
    const meta = chunkMeta(chunk.rawJson);
    return Boolean(meta?.words && meta.words.length > 0);
  });
}

function chunkMeta(rawJson: unknown): {
  whisper?: boolean;
  estimatedTiming?: boolean;
  words?: WhisperWord[];
} | null {
  if (!rawJson || typeof rawJson !== "object") return null;
  return rawJson as {
    whisper?: boolean;
    estimatedTiming?: boolean;
    words?: WhisperWord[];
  };
}

function cuesFromWords(
  words: WhisperWord[],
  chunkId: string,
  maxChars: number
): CaptionCue[] {
  const cues: CaptionCue[] = [];
  let lineWords: WhisperWord[] = [];
  let lineLen = 0;
  const MAX_CUE_SECONDS = 2.4;
  const MAX_SILENCE_GAP_SECONDS = 0.42;
  const MAX_WORDS_PER_CUE = 7;
  const MAX_CUE_CHARS = Math.floor(maxChars * 1.55);

  const flush = () => {
    if (lineWords.length === 0) return;
    const text = wrapCaptionText(
      lineWords.map((w) => w.word.trim()).join(" "),
      maxChars
    );
    if (!text) return;
    cues.push({
      id: `${chunkId}-w${cues.length}`,
      startTimeSeconds: lineWords[0]!.start,
      endTimeSeconds: lineWords[lineWords.length - 1]!.end,
      text,
      words: lineWords.map((w) => ({
        start: w.start,
        end: w.end,
        word: w.word.trim(),
      })),
    });
    lineWords = [];
    lineLen = 0;
  };

  for (const word of words) {
    const piece = sanitizeCaptionText(word.word);
    if (!isValidCaptionText(piece)) continue;
    const cleanWord = { ...word, word: piece };
    const previous = lineWords[lineWords.length - 1];
    const cueStart = lineWords[0]?.start ?? cleanWord.start;
    const crossesPause = previous
      ? cleanWord.start - previous.end >= MAX_SILENCE_GAP_SECONDS
      : false;
    const tooLong = cleanWord.end - cueStart > MAX_CUE_SECONDS;
    const sentenceEnded = previous
      ? /[.!?]["')\]]?$/.test(previous.word.trim())
      : false;
    const phraseEnded = previous
      ? /[,;:]["')\]]?$/.test(previous.word.trim()) && lineWords.length >= 3
      : false;
    if (
      lineWords.length > 0 &&
      (crossesPause ||
        tooLong ||
        sentenceEnded ||
        phraseEnded ||
        lineWords.length >= MAX_WORDS_PER_CUE)
    ) {
      flush();
    }
    const addLen = lineLen > 0 ? piece.length + 1 : piece.length;
    if (lineLen + addLen > MAX_CUE_CHARS && lineWords.length > 0) {
      flush();
    }
    lineWords.push(cleanWord);
    lineLen += lineLen > 0 ? piece.length + 1 : piece.length;
  }
  flush();

  // A stranded final function word reads like an editing mistake. Pull a
  // one-word tail into the previous phrase when the combined cue still fits.
  if (cues.length >= 2) {
    const tail = cues[cues.length - 1]!;
    const previous = cues[cues.length - 2]!;
    const tailWords = tail.words ?? [];
    const previousWords = previous.words ?? [];
    const combinedWords = [...previousWords, ...tailWords];
    const combinedText = combinedWords.map((word) => word.word).join(" ");
    if (
      tailWords.length === 1 &&
      previousWords.length <= 5 &&
      tail.endTimeSeconds - previous.startTimeSeconds <= 2.8 &&
      combinedText.length <= maxChars * 2
    ) {
      previous.endTimeSeconds = tail.endTimeSeconds;
      previous.words = combinedWords;
      previous.text = wrapCaptionText(combinedText, maxChars);
      cues.pop();
    }
  }
  return cues;
}

function cuesFromUntimedText(
  text: string,
  chunkId: string,
  startTimeSeconds: number,
  endTimeSeconds: number,
  maxChars: number
): CaptionCue[] {
  const tokens = sanitizeCaptionText(text).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];

  const groups: string[][] = [];
  let group: string[] = [];
  let chars = 0;
  const maxCueChars = Math.floor(maxChars * 1.55);
  const flush = () => {
    if (group.length > 0) groups.push(group);
    group = [];
    chars = 0;
  };

  for (const token of tokens) {
    const previous = group[group.length - 1];
    const hardBoundary = previous ? /[.!?]["')\]]?$/.test(previous) : false;
    const softBoundary =
      previous && group.length >= 3 ? /[,;:]["')\]]?$/.test(previous) : false;
    const nextChars = chars + (group.length > 0 ? 1 : 0) + token.length;
    if (
      group.length > 0 &&
      (hardBoundary || softBoundary || group.length >= 7 || nextChars > maxCueChars)
    ) {
      flush();
    }
    group.push(token);
    chars += (group.length > 1 ? 1 : 0) + token.length;
  }
  flush();

  if (groups.length >= 2 && groups.at(-1)!.length === 1) {
    const previous = groups.at(-2)!;
    const tail = groups.at(-1)!;
    if ([...previous, ...tail].join(" ").length <= maxChars * 2) {
      previous.push(...tail);
      groups.pop();
    }
  }

  const span = Math.max(0.05, endTimeSeconds - startTimeSeconds);
  const weights = groups.map((tokensInGroup) =>
    Math.max(1, tokensInGroup.join(" ").length)
  );
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = startTimeSeconds;

  return groups.map((tokensInGroup, index) => {
    const groupEnd =
      index === groups.length - 1
        ? endTimeSeconds
        : cursor + span * (weights[index]! / totalWeight);
    const cue: CaptionCue = {
      id: groups.length === 1 ? chunkId : `${chunkId}-p${index}`,
      startTimeSeconds: cursor,
      endTimeSeconds: Math.max(cursor + 0.05, groupEnd),
      text: wrapCaptionText(tokensInGroup.join(" "), maxChars),
    };
    cursor = groupEnd;
    return cue;
  });
}

function mergeCaptionPair(
  first: CaptionCue,
  second: CaptionCue,
  maxChars: number
): CaptionCue {
  const combinedWords =
    first.words && second.words ? [...first.words, ...second.words] : undefined;
  return {
    id: first.id,
    startTimeSeconds: first.startTimeSeconds,
    endTimeSeconds: second.endTimeSeconds,
    text: wrapCaptionText(`${first.text} ${second.text}`, maxChars),
    ...(combinedWords ? { words: combinedWords } : {}),
  };
}

/** Repair overflow tails created when neighboring transcript chunks split a phrase. */
function mergeOrphanCaptionCues(
  source: CaptionCue[],
  maxChars: number
): CaptionCue[] {
  const cues: CaptionCue[] = source.map((cue) => ({
    ...cue,
    words: cue.words?.map((word) => ({ ...word })),
  }));
  const tokenCount = (cue: CaptionCue) =>
    cue.text.replace(/\n/g, " ").split(/\s+/).filter(Boolean).length;
  const canFit = (first: CaptionCue, second: CaptionCue) =>
    second.startTimeSeconds - first.endTimeSeconds <= 0.18 &&
    second.endTimeSeconds - first.startTimeSeconds <= 2.8 &&
    `${first.text} ${second.text}`.replace(/\n/g, " ").length <= maxChars * 1.7;

  for (let index = 0; index < cues.length; index += 1) {
    const cue = cues[index]!;
    if (tokenCount(cue) !== 1) continue;
    const previous = cues[index - 1];
    const next = cues[index + 1];
    const previousIsIncomplete = previous
      ? !/[.!?]["')\]]?$/.test(previous.text.trim())
      : false;
    const cueIsConnector = /[,;:]\s*$/.test(cue.text.trim());

    if (previous && previousIsIncomplete && canFit(previous, cue)) {
      cues.splice(index - 1, 2, mergeCaptionPair(previous, cue, maxChars));
      index -= 1;
      continue;
    }
    if (next && cueIsConnector && canFit(cue, next)) {
      cues.splice(index, 2, mergeCaptionPair(cue, next, maxChars));
      index -= 1;
    }
  }
  return cues;
}

function wordsWithinChunk(
  words: WhisperWord[],
  chunkStart: number,
  chunkEnd: number
): WhisperWord[] {
  return words
    .flatMap((word) => {
      if (
        !Number.isFinite(word.start) ||
        !Number.isFinite(word.end) ||
        word.end <= word.start
      ) {
        return [];
      }
      const start = Math.max(chunkStart, Math.min(chunkEnd, word.start));
      const end = Math.max(start, Math.min(chunkEnd, word.end));
      if (end - start < 0.01) return [];
      return [{ ...word, start, end }];
    })
    .sort((a, b) => a.start - b.start || a.end - b.end);
}

function hasUnreliableWordTiming(
  words: WhisperWord[],
  text: string,
  chunkStart: number,
  chunkEnd: number
): boolean {
  if (words.length < 3) return false;
  const tokenCount = text.replace(/\n/g, " ").split(/\s+/).filter(Boolean).length;
  if (tokenCount < 3) return false;

  const durations = words
    .map((word) => Math.max(0, word.end - word.start))
    .filter((duration) => duration > 0)
    .sort((a, b) => a - b);
  if (durations.length < 3) return false;

  const medianDuration = durations[Math.floor(durations.length / 2)]!;
  const timedDuration = durations.reduce((sum, duration) => sum + duration, 0);
  const chunkDuration = Math.max(0.1, chunkEnd - chunkStart);
  const minimumPlausibleSpeech = Math.min(
    chunkDuration,
    Math.max(0.8, tokenCount * 0.14)
  );

  return medianDuration < 0.07 && timedDuration < minimumPlausibleSpeech * 0.4;
}

function recoveredSpeechWindow(
  words: WhisperWord[],
  text: string,
  chunkStart: number,
  chunkEnd: number
): { start: number; end: number } {
  const tokenCount = text.replace(/\n/g, " ").split(/\s+/).filter(Boolean).length;
  const chunkDuration = Math.max(0.1, chunkEnd - chunkStart);
  const duration = Math.min(
    chunkDuration,
    Math.max(1.2, tokenCount * 0.28, text.length / 18)
  );
  const centers = words
    .map((word) => (word.start + word.end) / 2)
    .sort((a, b) => a - b);
  const center = centers[Math.floor(centers.length / 2)] ??
    chunkStart + chunkDuration / 2;
  const start = Math.max(
    chunkStart,
    Math.min(chunkEnd - duration, center - duration / 2)
  );
  return { start, end: Math.min(chunkEnd, start + duration) };
}

/** Build a sorted caption timeline from transcript chunks (independent of video layer). */
export function buildCaptionTrack(
  chunks: TranscriptChunkInput[],
  format: RenderFormat = "native"
): CaptionCue[] {
  const maxChars = maxCharsPerCaptionLine(format);
  const cues: CaptionCue[] = [];

  for (const chunk of chunks) {
    if (!isValidCaptionText(chunk.text)) continue;
    const cleanText = sanitizeCaptionText(chunk.text);

    const meta = chunkMeta(chunk.rawJson);
    if (meta?.words && meta.words.length > 0) {
      const words = wordsWithinChunk(
        meta.words,
        chunk.startTimeSeconds,
        chunk.endTimeSeconds
      );
      if (words.length > 0) {
        if (
          hasUnreliableWordTiming(
            words,
            cleanText,
            chunk.startTimeSeconds,
            chunk.endTimeSeconds
          )
        ) {
          const recovered = recoveredSpeechWindow(
            words,
            cleanText,
            chunk.startTimeSeconds,
            chunk.endTimeSeconds
          );
          cues.push(
            ...cuesFromUntimedText(
              cleanText,
              `${chunk.id}-recovered`,
              recovered.start,
              recovered.end,
              maxChars
            )
          );
        } else {
          cues.push(...cuesFromWords(words, chunk.id, maxChars));
        }
        continue;
      }
    }

    if (meta?.estimatedTiming) {
      const slices = distributeTextAcrossSpan(
        cleanText,
        chunk.startTimeSeconds,
        chunk.endTimeSeconds
      );
      for (let i = 0; i < slices.length; i++) {
        const slice = slices[i]!;
        cues.push(
          ...cuesFromUntimedText(
            slice.text,
            `${chunk.id}-e${i}`,
            slice.startTimeSeconds,
            slice.endTimeSeconds,
            maxChars
          )
        );
      }
      continue;
    }

    // Preserve Whisper's segment window while splitting long text into compact,
    // readable phrases. No words are discarded when a segment exceeds two lines.
    cues.push(
      ...cuesFromUntimedText(
        cleanText,
        chunk.id,
        chunk.startTimeSeconds,
        Math.max(chunk.endTimeSeconds, chunk.startTimeSeconds + 0.05),
        maxChars
      )
    );
  }

  return directCaptionTrack(
    resolveCaptionOverlaps(
      mergeOrphanCaptionCues(cues, maxChars)
        .filter((c) => c.text.trim().length > 0)
        .sort((a, b) => a.startTimeSeconds - b.startTimeSeconds)
    )
  );
}

/** Binary search for the active cue at `timeSeconds`. */
export function lookupCueAtTime(
  track: CaptionCue[],
  timeSeconds: number
): CaptionCue | null {
  if (track.length === 0) return null;

  // Prefer the latest-started cue that covers this instant — matches what
  // viewers expect when Whisper segments overlap (editor shows one line).
  let best: CaptionCue | null = null;
  let previous: CaptionCue | null = null;
  for (const cue of track) {
    if (timeSeconds < cue.startTimeSeconds) {
      if (
        !best &&
        previous &&
        timeSeconds - previous.endTimeSeconds >= 0 &&
        timeSeconds - previous.endTimeSeconds <= 0.12
      ) {
        return previous;
      }
      break;
    }
    previous = cue;
    if (timeSeconds < cue.endTimeSeconds) {
      if (
        !best ||
        cue.startTimeSeconds > best.startTimeSeconds ||
        (cue.startTimeSeconds === best.startTimeSeconds &&
          cue.endTimeSeconds > best.endTimeSeconds)
      ) {
        best = cue;
      }
    }
  }
  return best;
}

/**
 * Trim cues so at most one is visible at any time — the editor only ever
 * shows a single active cue, but ASS burns every overlapping Dialogue at
 * once (which stacks text on text).
 *
 * When two cues overlap, the earlier one ends at the later one's start
 * (with a tiny gap so libass doesn't draw both on the same frame).
 */
export function resolveCaptionOverlaps<
  T extends {
    startTimeSeconds: number;
    endTimeSeconds: number;
    words?: CaptionWord[];
  },
>(cues: T[], minGapSeconds = 0.001): T[] {
  if (cues.length <= 1) return cues;

  const sorted = [...cues].sort(
    (a, b) =>
      a.startTimeSeconds - b.startTimeSeconds ||
      a.endTimeSeconds - b.endTimeSeconds
  );

  const resolved: T[] = [];
  for (const cue of sorted) {
    const previous = resolved[resolved.length - 1];
    if (!previous) {
      resolved.push({ ...cue });
      continue;
    }

    if (cue.startTimeSeconds < previous.endTimeSeconds) {
      const trimmedEnd = Math.max(
        previous.startTimeSeconds,
        cue.startTimeSeconds - minGapSeconds
      );
      if (trimmedEnd - previous.startTimeSeconds < 0.05) {
        // Previous cue is too short after trim — drop it in favor of the newer one.
        resolved.pop();
      } else {
        previous.endTimeSeconds = trimmedEnd;
        if (previous.words) {
          previous.words = previous.words
            .map((word) => ({
              ...word,
              end: Math.min(word.end, trimmedEnd),
              start: Math.min(word.start, trimmedEnd),
            }))
            .filter((word) => word.end > word.start && word.word.trim().length > 0);
        }
      }
    }

    resolved.push({
      ...cue,
      words: cue.words ? cue.words.map((word) => ({ ...word })) : cue.words,
    });
  }

  return resolved.filter((cue) => cue.endTimeSeconds - cue.startTimeSeconds >= 0.05);
}
