import { extractClipHook } from "@/lib/clipDescriptions";
import {
  containsInternalClipSignalLanguage,
  hasIncompleteClipThoughtEnding,
  isSpecificClickableClipTitle,
  looksLikeRawTranscriptFragment,
} from "@/lib/clipTitleQuality";
import { PLATFORM_PRESETS } from "@/lib/platforms/presets";
import type { PlatformCopy, PlatformKey } from "@/lib/platforms/types";

export interface PlatformCopyContext {
  platform: PlatformKey;
  clipTitle: string;
  clipReason: string;
  transcriptText: string;
  streamTitle?: string | null;
  streamDescription?: string | null;
  streamerName?: string | null;
  visualContext?: string | null;
  /** Names supplied by creator metadata or explicit speaker labels. */
  people?: string[];
  durationSeconds: number;
}

const KEYWORD_STOP_WORDS = new Set([
  "about", "after", "again", "also", "because", "before", "being",
  "candidate", "clip", "creator", "from", "great", "have", "highlights",
  "changed", "changes", "changing", "explained", "explains", "explaining",
  "into", "just", "like", "live", "livestream", "made", "makes", "moment", "original",
  "revealed", "reveals", "said", "says",
  "really", "short", "stream", "that", "their", "there", "they", "this",
  "through", "video", "what", "when", "where", "which", "with", "would",
  "your",
]);

const PROPER_NAME_STOP_WORDS = new Set([
  "A", "An", "And", "But", "For", "From", "Great", "How", "I", "If",
  "In", "It", "My", "No", "Of", "On", "Or", "So", "That", "The",
  "Then", "There", "These", "This", "To", "We", "What", "When", "Why",
  "With", "You",
]);

export function stripInternalClipCopy(value: string): string {
  const cleaned = value
    .replace(/\bGreat\s+\d+s\s+Short candidate at\s+\d{1,3}:\d{2}(?::\d{2})?\.?/gi, " ")
    .replace(/\b(?:Short candidate|candidate at|ranking score|confidence score)\b[^.]*\.?/gi, " ")
    .replace(/\b(?:Hook line|Audio|Hype spike|Chat reacted hard):\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  return cleaned
    .split(/(?<=[.!?])\s+|\s*\|\s*/)
    .map((sentence) => sentence.trim())
    .filter(
      (sentence) =>
        sentence.length > 0 &&
        !containsInternalClipSignalLanguage(sentence) &&
        !hasIncompleteClipThoughtEnding(sentence) &&
        !looksLikeRawTranscriptFragment(sentence) &&
        !/\b(?:was detected|analysis signal|producer note)\b/i.test(sentence)
    )
    .join(" ")
    .trim();
}

function cleanSourceText(value: string): string {
  return stripInternalClipCopy(value)
    .replace(/\[(?:silence|processing error|live transcript[^\]]*)\]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .map((word) => word ? `${word[0]!.toLocaleUpperCase()}${word.slice(1)}` : word)
    .join(" ");
}

function keywordToHashtag(value: string): string {
  const clean = value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.replace(/[^\p{L}\p{N}_]/gu, ""))
    .filter(Boolean)
    .map((part) => titleCase(part))
    .join("");
  return clean ? `#${clean}` : "";
}

function uniqueByLowercase(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLocaleLowerCase();
    if (!value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const DANGLING_ENDING = new Set([
  "a", "an", "and", "as", "at", "because", "but", "by", "for", "from",
  "if", "in", "into", "of", "on", "or", "so", "than", "that", "the",
  "then", "to", "when", "while", "with", "without",
]);

/** Keep platform copy inside a hard limit without publishing half a word or clause. */
export function truncatePlatformText(value: string, limit: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= limit) return clean;
  if (limit <= 1) return clean.slice(0, Math.max(0, limit));

  const candidate = clean.slice(0, limit + 1);
  const sentenceEnds = [...candidate.matchAll(/[.!?](?=\s|$)/g)]
    .map((match) => match.index ?? -1)
    .filter((index) => index >= Math.floor(limit * 0.58) && index < limit);
  const sentenceEnd = sentenceEnds.at(-1);
  let truncated = sentenceEnd != null
    ? candidate.slice(0, sentenceEnd + 1)
    : candidate.slice(0, limit).replace(/\s+\S*$/, "");
  truncated = truncated.replace(/[\s,;:|/\-–—]+$/g, "").trim();

  const words = truncated.split(/\s+/);
  while (
    words.length > 3 &&
    DANGLING_ENDING.has(words.at(-1)!.toLocaleLowerCase().replace(/[^a-z]/g, ""))
  ) {
    words.pop();
  }
  return words.join(" ").replace(/[\s,;:|/\-–—]+$/g, "").trim();
}

/** Extract grounded names and searchable topics from source metadata/transcript. */
export function extractPublishingKeywords(input: Omit<PlatformCopyContext, "platform" | "durationSeconds">): string[] {
  const sources = [
    ...(input.people ?? []).map((person) => ({ text: person, weight: 7 })),
    { text: input.clipTitle, weight: 5 },
    { text: input.streamTitle ?? "", weight: 4 },
    { text: input.streamDescription ?? "", weight: 2 },
    { text: input.visualContext ?? "", weight: 3 },
    { text: input.transcriptText, weight: 2 },
    { text: input.clipReason, weight: 1 },
    { text: input.streamerName ?? "", weight: 4 },
  ];
  const scored = new Map<string, { label: string; score: number; first: number }>();
  let order = 0;

  for (const source of sources) {
    const text = cleanSourceText(source.text);
    const properNames = text.match(
      /\b(?:\p{Lu}[\p{L}\p{N}'’.-]*|[A-Z]{2,})(?:\s+(?:\p{Lu}[\p{L}\p{N}'’.-]*|[A-Z]{2,})){0,5}\b/gu
    ) ?? [];
    for (const phrase of properNames) {
      const parts = phrase.split(/\s+/);
      const variants = [
        ...(parts.length <= 3 ? [phrase] : []),
        ...parts.slice(0, -1).map((part, index) =>
          [part, parts[index + 1]].join(" ")
        ),
        ...parts.slice(0, -2).map((part, index) =>
          [part, parts[index + 1], parts[index + 2]].join(" ")
        ),
      ];
      for (const variant of variants) {
        const variantWords = variant.toLocaleLowerCase().split(/\s+/);
        if (
          PROPER_NAME_STOP_WORDS.has(variant) ||
          variant.length < 3 ||
          variantWords.some((word) => KEYWORD_STOP_WORDS.has(word))
        ) continue;
        const key = variant.toLocaleLowerCase();
        const current = scored.get(key);
        scored.set(key, {
          label: variant,
          score:
            (current?.score ?? 0) +
            source.weight +
            (variant.includes(" ") ? 4 : 2),
          first: current?.first ?? order++,
        });
      }
    }

    for (const token of text.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]{3,}/gu) ?? []) {
      const key = token.toLocaleLowerCase();
      if (KEYWORD_STOP_WORDS.has(key) || /^\d+$/.test(key)) continue;
      const current = scored.get(key);
      scored.set(key, {
        label: current?.label ?? token,
        score: (current?.score ?? 0) + source.weight,
        first: current?.first ?? order++,
      });
    }
  }

  const ranked = [...scored.values()]
    .filter((item) => item.label.includes(" ") || item.score >= 6)
    .sort((a, b) => b.score - a.score || a.first - b.first)
    .map((item) => item.label);
  const selected: string[] = [];
  for (const value of ranked) {
    const words = new Set(value.toLocaleLowerCase().split(/\s+/));
    const overlaps = selected.some((other) => {
      const otherWords = new Set(other.toLocaleLowerCase().split(/\s+/));
      const shared = [...words].filter((word) => otherWords.has(word)).length;
      if (shared === 0) return false;
      if (words.size === 1 || otherWords.size === 1) return true;
      if (words.size <= 2 && otherWords.size <= 2) return true;
      return shared >= 2 && shared / Math.min(words.size, otherWords.size) >= 0.66;
    });
    if (!overlaps) selected.push(value);
    if (selected.length >= 10) break;
  }
  return selected;
}

function publishableTitle(input: PlatformCopyContext): string {
  const raw = cleanSourceText(input.clipTitle)
    .replace(/^(?:Peak|Best) moment\s*[·:-]?\s*\d{1,3}:\d{2}(?::\d{2})?$/i, "")
    .replace(/^Clip\s+\d{1,3}:\d{2}(?::\d{2})?$/i, "")
    .trim();
  const generic = /^(?:stream moment|stream highlight|highlight|moment|untitled)$/i;
  const transcriptHook = extractClipHook(cleanSourceText(input.transcriptText));
  const streamTitle = truncatePlatformText(
    cleanSourceText(input.streamTitle ?? ""),
    72
  );
  for (const candidate of [raw, transcriptHook, streamTitle]) {
    if (!candidate || generic.test(candidate)) continue;
    const shortened = truncatePlatformText(candidate, 72);
    if (isSpecificClickableClipTitle(shortened)) return shortened;
  }
  const verifiedPerson = input.people?.find((person) => person.trim().length >= 3);
  const safeFallback = verifiedPerson
    ? `${verifiedPerson.trim()} Explains the Central Point`
    : "The Conversation Reaches Its Central Point";
  return truncatePlatformText(safeFallback, 72);
}

function transcriptSummary(input: PlatformCopyContext, keywords: string[]): string {
  const title = publishableTitle(input);
  const keywordSet = keywords.slice(0, 5).map((keyword) => keyword.toLocaleLowerCase());
  const sources = [
    { value: input.transcriptText, sourceScore: 8 },
    { value: input.clipReason, sourceScore: 6 },
    { value: input.streamDescription ?? "", sourceScore: 3 },
  ];
  const candidates = sources.flatMap(({ value, sourceScore }, sourceIndex) =>
    cleanSourceText(value)
      .split(/(?<=[.!?])\s+|\n+/)
      .map((sentence) => sentence.trim())
      .filter(
        (sentence) =>
          sentence.length >= 28 &&
          sentence.length <= 360 &&
          !containsInternalClipSignalLanguage(sentence) &&
          !hasIncompleteClipThoughtEnding(sentence) &&
          !looksLikeRawTranscriptFragment(sentence) &&
          sentence.toLocaleLowerCase() !== title.toLocaleLowerCase() &&
          !/self-contained excerpt from the original conversation/i.test(sentence)
      )
      .map((sentence, index) => ({ sentence, index, sourceIndex, sourceScore }))
  );
  const best = candidates
    .map(({ sentence, index, sourceIndex, sourceScore }) => ({
      sentence,
      index,
      sourceIndex,
      score:
        sourceScore +
        keywordSet.reduce(
          (score, keyword) =>
            score + (sentence.toLocaleLowerCase().includes(keyword) ? 4 : 0),
          0
        ) + (/[!?]$/.test(sentence) ? 2 : 0),
    }))
    .sort(
      (a, b) =>
        b.score - a.score || a.sourceIndex - b.sourceIndex || a.index - b.index
    )[0]?.sentence;
  if (best) return best;
  const verifiedPerson = input.people?.find((person) => person.trim().length >= 3);
  if (verifiedPerson) {
    return `${verifiedPerson.trim()} develops the main idea in this excerpt.`;
  }
  if (input.streamerName?.trim()) {
    return `${input.streamerName.trim()} develops the main idea with its surrounding context.`;
  }
  return "The speaker develops the main idea with its surrounding context.";
}

function platformHashtags(
  platform: PlatformKey,
  keywords: string[],
  streamerName?: string | null
): string[] {
  // YouTube Shorts does not use hashtags in the studio package.
  if (platform === "youtube_shorts" || platform === "youtube_landscape") {
    return [];
  }
  const preset = PLATFORM_PRESETS[platform];
  const topical = [...keywords, streamerName ?? ""]
    .map(keywordToHashtag)
    .filter(Boolean);
  const max = preset.hashtagRange?.max ?? 5;
  // Fewer grounded tags beat padding the post with generic #Reels/#Highlights.
  const result = uniqueByLowercase(topical).slice(0, max);
  return result.slice(0, max);
}

function mergeCaptionWithHashtags(caption: string, hashtags: string[], limit: number): string {
  const tags = hashtags.join(" ").trim();
  if (!tags) return truncatePlatformText(caption, limit);
  if (caption.toLocaleLowerCase().includes(tags.toLocaleLowerCase())) {
    return truncatePlatformText(caption, limit);
  }
  const fittingTags: string[] = [];
  for (const tag of hashtags) {
    const next = [...fittingTags, tag].join(" ");
    if (next.length >= limit) break;
    fittingTags.push(tag);
  }
  const suffix = fittingTags.join(" ");
  const captionLimit = Math.max(0, limit - (suffix ? suffix.length + 1 : 0));
  const body = truncatePlatformText(caption, captionLimit);
  return [body, suffix].filter(Boolean).join(" ").trim();
}

/** Strong deterministic copy used immediately and whenever AI is unavailable. */
export function buildFallbackPlatformCopy(input: PlatformCopyContext): PlatformCopy {
  const preset = PLATFORM_PRESETS[input.platform];
  const keywords = extractPublishingKeywords(input);
  const fullTitle = publishableTitle(input);
  const title = truncatePlatformText(fullTitle, preset.titleLimit ?? 100);
  const summary = transcriptSummary(input, keywords);
  const hashtags = platformHashtags(input.platform, keywords, input.streamerName);
  const creatorContext = input.streamerName?.trim()
    ? `From ${input.streamerName}${input.streamTitle?.trim() ? ` — ${input.streamTitle.trim()}` : ""}.`
    : input.streamTitle?.trim()
      ? `From ${input.streamTitle.trim()}.`
      : "";
  const captionBody = summary.toLocaleLowerCase().includes(title.toLocaleLowerCase())
    ? summary
    : `${title}. ${summary}`;
  const captionLimit = preset.captionLimit ?? 2200;
  const caption = mergeCaptionWithHashtags(captionBody, hashtags, captionLimit);
  const xText = mergeCaptionWithHashtags(
    captionBody,
    hashtags,
    preset.postTextLimit ?? 280
  );
  const primaryTopic = keywords[0] ?? input.streamerName ?? "this moment";
  const isYouTube = input.platform.startsWith("youtube");
  const isMergedCaptionPlatform =
    input.platform === "tiktok" ||
    input.platform.startsWith("instagram") ||
    input.platform.startsWith("facebook");

  return {
    title: isYouTube ? title : null,
    caption: isMergedCaptionPlatform ? caption : null,
    postText: input.platform === "x" ? xText : null,
    description: isYouTube
      ? [summary, creatorContext].filter(Boolean).join("\n\n")
      : null,
    // Keep structured metadata even when the platform also expects hashtags
    // inline. PackagingDNA and later performance learning need the exact tags
    // that produced a published post.
    hashtags,
    tags: isYouTube ? keywords.slice(0, 8) : [],
    quoteText: extractClipHook(cleanSourceText(input.transcriptText)) ?? title,
    thumbnailText: null,
    pinnedComment: isYouTube
      ? `What’s your take on ${primaryTopic}?`
      : null,
  };
}
