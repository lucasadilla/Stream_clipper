import { sanitizeCaptionText } from "@/lib/captionStyles";

const MIN_LOOP_REPEATS = 3;
const MIN_LOOP_TOKENS = 2;
const MIN_LOOP_CHARACTERS = 10;
const MAX_LOOP_TOKENS = 24;

function normalizedToken(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[^\p{L}\p{N}']/gu, "")
    .trim();
}

function blocksMatch(
  normalized: string[],
  firstStart: number,
  secondStart: number,
  length: number
): boolean {
  for (let offset = 0; offset < length; offset += 1) {
    if (normalized[firstStart + offset] !== normalized[secondStart + offset]) {
      return false;
    }
  }
  return true;
}

/**
 * Collapse only strong, adjacent phrase loops: at least two meaningful tokens
 * repeated three times. Keeping the first copy preserves intentionally echoed
 * speech while preventing an STT hallucination from filling the caption track.
 */
export function collapseRepeatedTranscriptItems<T>(
  items: T[],
  textForItem: (item: T) => string
): T[] {
  if (items.length < MIN_LOOP_REPEATS * MIN_LOOP_TOKENS) return items;

  const normalized = items.map((item) => normalizedToken(textForItem(item)));
  const output: T[] = [];

  for (let index = 0; index < items.length;) {
    let best:
      | { phraseLength: number; repeatCount: number; removedItems: number }
      | null = null;
    const maxPhraseLength = Math.min(
      MAX_LOOP_TOKENS,
      Math.floor((items.length - index) / MIN_LOOP_REPEATS)
    );

    for (
      let phraseLength = MIN_LOOP_TOKENS;
      phraseLength <= maxPhraseLength;
      phraseLength += 1
    ) {
      const phraseTokens = normalized.slice(index, index + phraseLength);
      if (phraseTokens.some((token) => !token)) continue;
      if (phraseTokens.join(" ").length < MIN_LOOP_CHARACTERS) continue;

      let repeatCount = 1;
      while (
        index + (repeatCount + 1) * phraseLength <= items.length &&
        blocksMatch(
          normalized,
          index,
          index + repeatCount * phraseLength,
          phraseLength
        )
      ) {
        repeatCount += 1;
      }

      const requiredRepeats = phraseLength === 2 ? 4 : MIN_LOOP_REPEATS;
      if (repeatCount < requiredRepeats) continue;
      const removedItems = phraseLength * (repeatCount - 1);
      if (!best || removedItems > best.removedItems) {
        best = { phraseLength, repeatCount, removedItems };
      }
    }

    if (!best) {
      output.push(items[index]!);
      index += 1;
      continue;
    }

    output.push(...items.slice(index, index + best.phraseLength));
    index += best.phraseLength * best.repeatCount;
  }

  return output.length === items.length ? items : output;
}

export function collapseRepeatedTranscriptWords<T extends { word: string }>(
  words: T[]
): T[] {
  return collapseRepeatedTranscriptItems(words, (word) => word.word);
}

/** Collapse identical consecutive phrases even when each phrase is one segment. */
export function collapseRepeatedTranscriptBlocks<T>(
  items: T[],
  textForItem: (item: T) => string
): T[] {
  if (items.length < MIN_LOOP_REPEATS) return items;
  const normalized = items.map((item) =>
    sanitizeCaptionText(textForItem(item))
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}']+/gu, " ")
      .trim()
  );
  const output: T[] = [];

  for (let index = 0; index < items.length;) {
    let best:
      | { blockLength: number; repeatCount: number; removedItems: number }
      | null = null;
    const maxBlockLength = Math.min(6, Math.floor((items.length - index) / 3));

    for (let blockLength = 1; blockLength <= maxBlockLength; blockLength += 1) {
      const phrase = normalized.slice(index, index + blockLength).join(" ");
      const phraseTokenCount = phrase.split(/\s+/).filter(Boolean).length;
      if (phrase.length < MIN_LOOP_CHARACTERS || phraseTokenCount < 2) continue;

      let repeatCount = 1;
      while (index + (repeatCount + 1) * blockLength <= items.length) {
        const nextStart = index + repeatCount * blockLength;
        let matches = true;
        for (let offset = 0; offset < blockLength; offset += 1) {
          if (normalized[index + offset] !== normalized[nextStart + offset]) {
            matches = false;
            break;
          }
        }
        if (!matches) break;
        repeatCount += 1;
      }

      const requiredRepeats = phraseTokenCount === 2 ? 4 : 3;
      if (repeatCount < requiredRepeats) continue;
      const removedItems = blockLength * (repeatCount - 1);
      if (!best || removedItems > best.removedItems) {
        best = { blockLength, repeatCount, removedItems };
      }
    }

    if (!best) {
      output.push(items[index]!);
      index += 1;
      continue;
    }
    output.push(...items.slice(index, index + best.blockLength));
    index += best.blockLength * best.repeatCount;
  }

  return output.length === items.length ? items : output;
}

export function collapseRepeatedTranscriptText(text: string): string {
  const tokens = sanitizeCaptionText(text).split(/\s+/).filter(Boolean);
  const collapsed = collapseRepeatedTranscriptItems(tokens, (token) => token);
  return collapsed
    .join(" ")
    .replace(/\s+([,.;:!?%\]\)])/g, "$1")
    .replace(/([\[\(])\s+/g, "$1")
    .trim();
}

export function transcriptLoopRatio(text: string): number {
  const tokens = sanitizeCaptionText(text).split(/\s+/).filter(Boolean);
  if (tokens.length < MIN_LOOP_REPEATS * MIN_LOOP_TOKENS) return 0;
  const collapsed = collapseRepeatedTranscriptItems(tokens, (token) => token);
  return (tokens.length - collapsed.length) / tokens.length;
}
