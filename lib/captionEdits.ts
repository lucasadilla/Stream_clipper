import type { CaptionCue, CaptionWord } from "@/lib/captionTrack";

export const MIN_CUE_DURATION = 0.2;

export interface CaptionCueEdit {
  cueId: string;
  text?: string;
  startTimeSeconds?: number;
  endTimeSeconds?: number;
}

export type CaptionEditsMap = Record<string, Omit<CaptionCueEdit, "cueId">>;

export function clampCueRange(
  start: number,
  end: number,
  maxTime: number,
  minDuration = MIN_CUE_DURATION
): { startTimeSeconds: number; endTimeSeconds: number } {
  let s = Math.max(0, Math.min(start, maxTime));
  let e = Math.max(0, Math.min(end, maxTime));
  if (e < s) [s, e] = [e, s];
  if (e - s < minDuration) {
    e = Math.min(s + minDuration, maxTime);
    if (e - s < minDuration) s = Math.max(0, e - minDuration);
  }
  return { startTimeSeconds: s, endTimeSeconds: e };
}

/**
 * Keep karaoke word timestamps aligned when a cue is moved or trimmed.
 * - Pure move (same duration): shift every word by the same delta.
 * - Trim / stretch: clamp words into the new [start, end] window.
 */
export function remapCueWords(
  words: CaptionWord[] | undefined,
  previousStart: number,
  previousEnd: number,
  nextStart: number,
  nextEnd: number
): CaptionWord[] | undefined {
  if (!words || words.length === 0) return words;

  const prevDuration = previousEnd - previousStart;
  const nextDuration = nextEnd - nextStart;
  const delta = nextStart - previousStart;
  const isPureMove =
    Math.abs(prevDuration - nextDuration) < 0.001 && Math.abs(delta) > 0.001;

  if (isPureMove) {
    return words.map((word) => ({
      ...word,
      start: word.start + delta,
      end: word.end + delta,
    }));
  }

  // No timing change — keep words as-is.
  if (Math.abs(delta) < 0.001 && Math.abs(prevDuration - nextDuration) < 0.001) {
    return words;
  }

  return words
    .map((word) => {
      const start = Math.max(nextStart, Math.min(word.start, nextEnd));
      const end = Math.max(start, Math.min(word.end, nextEnd));
      return { ...word, start, end };
    })
    .filter((word) => word.end > word.start && word.word.trim().length > 0);
}

export function applyCaptionEdits(
  cues: CaptionCue[],
  edits: CaptionEditsMap
): CaptionCue[] {
  if (Object.keys(edits).length === 0) return cues;

  return cues
    .map((cue) => {
      const edit = edits[cue.id];
      if (!edit) return cue;

      const start = edit.startTimeSeconds ?? cue.startTimeSeconds;
      const end = edit.endTimeSeconds ?? cue.endTimeSeconds;
      const clamped = clampCueRange(start, end, Number.MAX_SAFE_INTEGER);

      const nextText = edit.text ?? cue.text;
      const textChanged = edit.text !== undefined && edit.text !== cue.text;

      return {
        ...cue,
        text: nextText,
        // Text edits invalidate word timings for karaoke.
        words: textChanged
          ? undefined
          : remapCueWords(
              cue.words,
              cue.startTimeSeconds,
              cue.endTimeSeconds,
              clamped.startTimeSeconds,
              clamped.endTimeSeconds
            ),
        startTimeSeconds: clamped.startTimeSeconds,
        endTimeSeconds: clamped.endTimeSeconds,
      };
    })
    .sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);
}

export function mergeCaptionEdit(
  edits: CaptionEditsMap,
  cueId: string,
  patch: Partial<Omit<CaptionCueEdit, "cueId">>
): CaptionEditsMap {
  return {
    ...edits,
    [cueId]: {
      ...edits[cueId],
      ...patch,
    },
  };
}
