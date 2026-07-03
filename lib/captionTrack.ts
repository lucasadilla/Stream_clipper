import type { RenderFormat } from "@/lib/renderFormat";
import {
  isValidCaptionText,
  maxCharsPerCaptionLine,
  wrapCaptionText,
} from "@/lib/captionStyles";
import { distributeTextAcrossSpan } from "@/lib/transcriptTiming";

export interface CaptionCue {
  id: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  text: string;
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
    });
    lineWords = [];
    lineLen = 0;
  };

  for (const word of words) {
    const piece = word.word.trim();
    if (!piece) continue;
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
    const span = chunk.endTimeSeconds - chunk.startTimeSeconds;

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

  let lo = 0;
  let hi = track.length - 1;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const cue = track[mid]!;
    if (timeSeconds < cue.startTimeSeconds) {
      hi = mid - 1;
    } else if (timeSeconds >= cue.endTimeSeconds) {
      lo = mid + 1;
    } else {
      return cue;
    }
  }
  return null;
}
