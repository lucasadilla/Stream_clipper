import { extractClipHook } from "@/lib/clipDescriptions";
import { PLATFORM_PRESETS } from "@/lib/platforms/presets";
import type { PlatformCopy, PlatformKey } from "@/lib/platforms/types";

export interface PlatformCopyContext {
  platform: PlatformKey;
  clipTitle: string;
  clipReason: string;
  transcriptText: string;
  streamTitle?: string | null;
  streamerName?: string | null;
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
  return value
    .replace(/\bGreat\s+\d+s\s+Short candidate at\s+\d{1,3}:\d{2}(?::\d{2})?\.?/gi, " ")
    .replace(/\b(?:Short candidate|candidate at|ranking score|confidence score)\b[^.]*\.?/gi, " ")
    .replace(/\b(?:Hook line|Audio|Hype spike|Chat reacted hard):\s*/gi, "")
    .replace(/\s+/g, " ")
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

/** Extract grounded names and searchable topics from source metadata/transcript. */
export function extractPublishingKeywords(input: Omit<PlatformCopyContext, "platform" | "durationSeconds">): string[] {
  const sources = [
    { text: input.clipTitle, weight: 5 },
    { text: input.streamTitle ?? "", weight: 4 },
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
  const candidate = raw && !generic.test(raw) ? raw : transcriptHook ?? "Worth Hearing Twice";
  return candidate.slice(0, 100).replace(/\s+\S*$/, (tail) =>
    candidate.length > 100 ? "" : tail
  ).trim();
}

function transcriptSummary(input: PlatformCopyContext, keywords: string[]): string {
  const transcript = cleanSourceText(input.transcriptText);
  const sentences = transcript
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 28 && sentence.length <= 260);
  const keywordSet = keywords.slice(0, 5).map((keyword) => keyword.toLocaleLowerCase());
  const best = sentences
    .map((sentence, index) => ({
      sentence,
      index,
      score:
        keywordSet.reduce(
          (score, keyword) =>
            score + (sentence.toLocaleLowerCase().includes(keyword) ? 4 : 0),
          0
        ) + (/[!?]$/.test(sentence) ? 2 : 0),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)[0]?.sentence;
  if (best) return best;

  const reason = cleanSourceText(input.clipReason);
  if (reason.length >= 28) return reason.slice(0, 360).trim();
  const hook = extractClipHook(transcript);
  if (hook) return hook;
  return publishableTitle(input);
}

function platformHashtags(
  platform: PlatformKey,
  keywords: string[],
  streamerName?: string | null
): string[] {
  const preset = PLATFORM_PRESETS[platform];
  const platformTags =
    platform === "youtube_shorts"
      ? ["#Shorts"]
      : platform === "instagram_reels" || platform === "facebook_reels"
        ? ["#Reels"]
        : [];
  const topical = [...keywords, streamerName ?? ""]
    .map(keywordToHashtag)
    .filter(Boolean);
  const usefulFallbacks = ["#LiveStream", "#Highlights"];
  const max = preset.hashtagRange?.max ?? (platform === "x" ? 2 : 5);
  const min = preset.hashtagRange?.min ?? 0;
  const result = uniqueByLowercase([...platformTags, ...topical]).slice(0, max);
  for (const fallback of usefulFallbacks) {
    if (result.length >= min || result.length >= max) break;
    if (!result.some((tag) => tag.toLocaleLowerCase() === fallback.toLocaleLowerCase())) {
      result.push(fallback);
    }
  }
  return result.slice(0, max);
}

/** Strong deterministic copy used immediately and whenever AI is unavailable. */
export function buildFallbackPlatformCopy(input: PlatformCopyContext): PlatformCopy {
  const preset = PLATFORM_PRESETS[input.platform];
  const keywords = extractPublishingKeywords(input);
  const fullTitle = publishableTitle(input);
  const title = fullTitle.slice(0, preset.titleLimit ?? 100).trim();
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
  const caption = captionBody.slice(0, preset.captionLimit ?? 2200).trim();
  const xText = `${captionBody}${hashtags[0] ? ` ${hashtags[0]}` : ""}`.slice(0, 280).trim();
  const primaryTopic = keywords[0] ?? input.streamerName ?? "this moment";
  const tags = uniqueByLowercase([
    ...keywords,
    ...(input.streamerName ? [input.streamerName] : []),
  ]).slice(0, 15);

  return {
    title,
    caption:
      input.platform === "x" || input.platform.startsWith("youtube")
        ? null
        : caption,
    postText: input.platform === "x" ? xText : null,
    description: input.platform.startsWith("youtube")
      ? [summary, creatorContext].filter(Boolean).join("\n\n")
      : null,
    hashtags,
    tags: input.platform.startsWith("youtube") ? tags : [],
    quoteText: extractClipHook(cleanSourceText(input.transcriptText)) ?? title,
    thumbnailText: input.platform.startsWith("youtube")
      ? title.split(/\s+/).slice(0, 6).join(" ").toLocaleUpperCase()
      : null,
    pinnedComment: input.platform.startsWith("youtube")
      ? `What’s your take on ${primaryTopic}?`
      : null,
  };
}
