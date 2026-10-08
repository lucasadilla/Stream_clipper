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
  "thank",
  "thanks",
  "the",
  "their",
  "them",
  "they",
  "this",
  "time",
  "to",
  "was",
  "we",
  "with",
  "very",
  "much",
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
const DISCOURSE_FRAGMENT_ENDING =
  /\b(?:(?:that|this|which)(?:'s| is)\s+(?:how|what|when|where|why)|on an ongoing basis|for some reason|and everything|or whatever)\??$/i;
const INTERNAL_SIGNAL_LANGUAGE =
  /\b(?:significant visual scene change|visual scene change|burst of visual motion|visual motion (?:was )?detected|detected independently of speech|prominent on-screen (?:interface|text) region changed|complete (?:reaction|narrative|story|setup-payoff|question-answer|problem-solution|claim-evidence|visual-payoff) arc|visually driven moment with a clear outcome|setup\s*,\s*(?:action\s*,\s*)?(?:reaction\s*,\s*)?payoff|structured visual (?:context|evidence)|ranking evidence|audio event|event window)\b/i;
const RAW_SPEECH_POLITENESS =
  /^(?:(?:this|and|so|well)\s+)?(?:thank you(?: very much)?|thanks (?:so|very) much)(?:\b|$)/i;
const BROKEN_DEICTIC_OPENING =
  /^(?:this|that|it)\s+(?:thank|thanks|you|i|we|he|she|they|and|but|so)\b/i;
const MISSING_OBJECT_ENDING =
  /\b(?:i|we|you|he|she|they)\s+(?:asked|brought|called|found|gave|got|heard|made|met|needed|remembered|saw|sent|showed|told|took|wanted|watched)\s*$/i;

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

/** Machine analysis notes are evidence for editors, never public copy. */
export function containsInternalClipSignalLanguage(value: string): boolean {
  return INTERNAL_SIGNAL_LANGUAGE.test(value);
}

/** Spoken fragments that depend on a missing prior sentence are not headlines. */
export function hasIncompleteClipThoughtEnding(value: string): boolean {
  const cleaned = value.trim().replace(/[.!?,;:]+$/g, "").trim();
  return (
    DANGLING_ENDING.test(cleaned) ||
    DISCOURSE_FRAGMENT_ENDING.test(cleaned) ||
    MISSING_OBJECT_ENDING.test(cleaned)
  );
}

/** Detect title-cased ASR chatter that is still not a standalone thought. */
export function looksLikeRawTranscriptFragment(value: string): boolean {
  const cleaned = value.trim().replace(/[.!?,;:]+$/g, "").trim();
  if (!cleaned) return true;
  return (
    RAW_SPEECH_POLITENESS.test(cleaned) ||
    BROKEN_DEICTIC_OPENING.test(cleaned) ||
    MISSING_OBJECT_ENDING.test(cleaned)
  );
}

/** Deterministic final gate for titles shown to creators or used in exports. */
export function isSpecificClickableClipTitle(title: string): boolean {
  const cleaned = title.trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length < 4 || words.length > 11 || cleaned.length > 72) return false;
  if (BROKEN_OPENING.test(cleaned) || hasIncompleteClipThoughtEnding(cleaned)) {
    return false;
  }
  if (SPOKEN_FILLER.test(cleaned)) return false;
  if (looksLikeRawTranscriptFragment(cleaned)) return false;
  if (containsInternalClipSignalLanguage(cleaned)) return false;
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
  if (meaningful.length < 3) return false;
  if (
    meaningful.length >= 4 &&
    uniqueMeaningful.size / meaningful.length < 0.72
  ) {
    return false;
  }
  if (/^[A-Z\d\W]+$/.test(cleaned) && /[A-Z]/.test(cleaned)) return false;
  return true;
}
