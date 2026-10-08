const TITLE_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "because",
  "but",
  "by",
  "for",
  "from",
  "he",
  "her",
  "him",
  "his",
  "i",
  "in",
  "is",
  "it",
  "its",
  "like",
  "my",
  "of",
  "on",
  "or",
  "our",
  "she",
  "so",
  "that",
  "the",
  "their",
  "them",
  "they",
  "this",
  "to",
  "was",
  "we",
  "with",
  "you",
  "your",
]);

const BROKEN_OPENING =
  /^(?:of|because|and|but|so|then|also|anyway|which|that|therefore|however)\b/i;
const DANGLING_ENDING =
  /\b(?:a|an|and|as|at|because|but|for|from|if|in|like|of|on|or|so|that|the|then|to|when|while|with|you know|feel like)\??$/i;
const SPOKEN_FILLER =
  /\b(?:you know|i mean|you feel like|kind of|sort of|basically|literally)\b/i;
const GENERIC_CLICKBAIT =
  /\b(?:you won'?t believe|what happens next|must watch|breaks the internet)\b/i;
const GENERIC_NOUNS =
  /\b(?:random|something|stuff|the biggest ones|this moment|stream highlight|stream clip)\b/i;

function normalizeTitleWord(word: string): string {
  return word.toLocaleLowerCase().replace(/[^a-z0-9']/g, "");
}

export function meaningfulClipTitleWords(value: string): string[] {
  return value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9']+/g, " ")
    .split(/\s+/)
    .filter(
      (word) =>
        word.length >= 3 &&
        !TITLE_STOP_WORDS.has(word) &&
        word !== "know" &&
        word !== "feel"
    );
}

/** Deterministic final gate for titles shown to creators or used in exports. */
export function isSpecificClickableClipTitle(title: string): boolean {
  const cleaned = title.trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length < 4 || words.length > 11 || cleaned.length > 72) return false;
  if (BROKEN_OPENING.test(cleaned) || DANGLING_ENDING.test(cleaned)) return false;
  if (SPOKEN_FILLER.test(cleaned)) return false;
  if (/^(?:insane|crazy|epic|shocking|unbelievable)\b/i.test(cleaned)) {
    return false;
  }
  if (GENERIC_CLICKBAIT.test(cleaned) || GENERIC_NOUNS.test(cleaned)) {
    return false;
  }
  if (/^(?:bro+|dude|lol|lmao)\b/i.test(cleaned)) return false;
  if (/\b\d{1,3}:\d{2}(?::\d{2})?\b/.test(cleaned)) return false;
  if (
    words.some((word) => {
      const normalized = normalizeTitleWord(word);
      return normalized.length === 1 && normalized !== "a" && normalized !== "i";
    })
  ) {
    return false;
  }

  const normalizedWords = words.map(normalizeTitleWord).filter(Boolean);
  const conversationalFillers = normalizedWords.filter((word) =>
    ["actually", "basically", "just", "know", "like", "really", "thing"].includes(
      word
    )
  ).length;
  if (conversationalFillers >= 2) return false;

  const meaningful = meaningfulClipTitleWords(cleaned);
  const uniqueMeaningful = new Set(meaningful);
  if (meaningful.length < 2) return false;
  if (
    meaningful.length >= 4 &&
    uniqueMeaningful.size / meaningful.length < 0.72
  ) {
    return false;
  }
  if (/^[A-Z\d\W]+$/.test(cleaned) && /[A-Z]/.test(cleaned)) return false;
  return true;
}
