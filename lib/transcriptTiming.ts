/** Rough speech rate for mapping plaintext (no Whisper segments) to wall time. */
export const SPEECH_CHARS_PER_SECOND = 14;

export interface TimedTextSlice {
  startTimeSeconds: number;
  endTimeSeconds: number;
  text: string;
}

/** Preserve spoken words whose provider timestamps collapse to an instant. */
export function repairCollapsedWordTimings<T extends { start: number; end: number; word: string }>(input: T[]): T[] {
  const words = input.filter((word) => Number.isFinite(word.start) && Number.isFinite(word.end))
    .map((word) => ({ ...word }));
  for (let index = 0; index < words.length; index++) {
    if (words[index]!.end > words[index]!.start) continue;
    const first = index;
    while (index + 1 < words.length && words[index + 1]!.end <= words[index + 1]!.start) index++;
    const next = words[index + 1];
    let startIndex = first;
    let endIndex = index;
    let start = words[first]!.start;
    let end = next?.start ?? words[index]!.start;
    if (end <= start && next) {
      endIndex = index + 1;
      end = next.end;
    } else if (end <= start && first > 0 && start - words[first - 1]!.end < 0.2) {
      startIndex = first - 1;
      start = words[startIndex]!.start;
      end = Math.max(words[startIndex]!.end, words[index]!.start);
    }
    const count = endIndex - startIndex + 1;
    const span = Math.max(0.02 * count, end - start);
    for (let slot = 0; slot < count; slot++) {
      words[startIndex + slot] = { ...words[startIndex + slot]!,
        start: start + span * slot / count, end: start + span * (slot + 1) / count };
    }
  }
  return words;
}

/** Spread transcript text proportionally across a time span (for STT without segments). */
export function distributeTextAcrossSpan(
  text: string,
  startSeconds: number,
  endSeconds: number
): TimedTextSlice[] {
  const trimmed = text.trim();
  const span = Math.max(endSeconds - startSeconds, 0.1);
  if (!trimmed) return [];

  const parts = trimmed.split(/(?<=[.!?])\s+/).filter((p) => p.trim().length > 0);
  if (parts.length <= 1) {
    return [{ startTimeSeconds: startSeconds, endTimeSeconds: endSeconds, text: trimmed }];
  }

  const totalChars = parts.reduce((sum, p) => sum + p.length, 0);
  let cursor = startSeconds;

  return parts.map((part, i) => {
    const fraction = part.length / totalChars;
    const duration =
      i === parts.length - 1 ? endSeconds - cursor : span * fraction;
    const slice = {
      startTimeSeconds: cursor,
      endTimeSeconds: cursor + duration,
      text: part.trim(),
    };
    cursor += duration;
    return slice;
  });
}

export function estimateSpeechDurationSeconds(text: string, maxSpanSeconds: number): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return Math.min(maxSpanSeconds, Math.max(4, trimmed.length / SPEECH_CHARS_PER_SECOND));
}

/** Where spoken words likely sit inside a chunk when Whisper returns no segment times. */
export function speechWindowInChunk(
  startSeconds: number,
  endSeconds: number,
  text: string
): { speechStart: number; speechEnd: number } {
  const span = Math.max(endSeconds - startSeconds, 0);
  const speechDuration = estimateSpeechDurationSeconds(text, span);
  const speechStart = startSeconds + Math.max(0, span - speechDuration);
  return {
    speechStart,
    speechEnd: speechStart + speechDuration,
  };
}

export function estimateTimeInSpeechWindow(
  text: string,
  startSeconds: number,
  endSeconds: number,
  query: string,
  termMatcher: (text: string, query: string) => number
): number {
  const { speechStart, speechEnd } = speechWindowInChunk(
    startSeconds,
    endSeconds,
    text
  );
  const speechSpan = Math.max(speechEnd - speechStart, 1);
  const lower = text.toLowerCase();
  const matchIdx = termMatcher(lower, query);

  if (matchIdx < 0 || text.length === 0) {
    return Math.round(speechStart + speechSpan / 2);
  }

  const ratio = matchIdx / text.length;
  return Math.round(speechStart + ratio * speechSpan);
}
