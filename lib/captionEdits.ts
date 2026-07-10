import type { CaptionCue } from "@/lib/captionTrack";

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
      return {
        ...cue,
        text: nextText,
        // Text edits invalidate word timings for karaoke.
        words: edit.text !== undefined && edit.text !== cue.text ? undefined : cue.words,
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
