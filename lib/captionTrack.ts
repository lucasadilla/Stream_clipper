import type { RenderFormat } from "@/lib/renderFormat";
import {
  isValidCaptionText,
  maxCharsPerCaptionLine,
  wrapCaptionText,
} from "@/lib/captionStyles";
import { distributeTextAcrossSpan } from "@/lib/transcriptTiming";

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
  const MAX_CUE_SECONDS = 2.8;
  const MAX_SILENCE_GAP_SECONDS = 0.55;
  const MAX_WORDS_PER_CUE = 8;

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
    const piece = word.word.trim();
    if (!piece) continue;
    const previous = lineWords[lineWords.length - 1];
    const cueStart = lineWords[0]?.start ?? word.start;
    const crossesPause = previous
      ? word.start - previous.end >= MAX_SILENCE_GAP_SECONDS
      : false;
    const tooLong = word.end - cueStart > MAX_CUE_SECONDS;
    const sentenceEnded = previous
      ? /[.!?]["')\]]?$/.test(previous.word.trim())
      : false;
    if (
      lineWords.length > 0 &&
      (crossesPause ||
        tooLong ||
        sentenceEnded ||
        lineWords.length >= MAX_WORDS_PER_CUE)
    ) {
      flush();
    }
    const addLen = lineLen > 0 ? piece.length + 1 : piece.length;
    if (lineLen + addLen > maxChars && lineWords.length > 0) {
      flush();
    }
    lineWords.push(word);
    lineLen += lineLen > 0 ? piece.length + 1 : piece.length;
  }
  flush();
  return cues;
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

    const meta = chunkMeta(chunk.rawJson);
    if (meta?.words && meta.words.length > 0) {
      cues.push(...cuesFromWords(meta.words, chunk.id, maxChars));
      continue;
    }

    if (meta?.estimatedTiming) {
      const slices = distributeTextAcrossSpan(
        chunk.text,
        chunk.startTimeSeconds,
        chunk.endTimeSeconds
      );
      for (let i = 0; i < slices.length; i++) {
        const slice = slices[i]!;
        cues.push({
          id: `${chunk.id}-e${i}`,
          startTimeSeconds: slice.startTimeSeconds,
          endTimeSeconds: slice.endTimeSeconds,
          text: wrapCaptionText(slice.text, maxChars),
        });
      }
      continue;
    }

    // Whisper segment timestamps — use as-is (no re-interpolation).
    cues.push({
      id: chunk.id,
      startTimeSeconds: chunk.startTimeSeconds,
      endTimeSeconds: Math.max(chunk.endTimeSeconds, chunk.startTimeSeconds + 0.05),
      text: wrapCaptionText(chunk.text, maxChars),
    });
  }

  return cues
    .filter((c) => c.text.trim().length > 0)
    .sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);
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
  for (const cue of track) {
    if (timeSeconds < cue.startTimeSeconds) break;
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
>(cues: T[], minGapSeconds = 0.04): T[] {
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
