import { formatSeconds } from "@/lib/time";

interface ChatQuote {
  authorName?: string;
  messageText: string;
}

interface BuildClipCopyInput {
  startTimeSeconds: number;
  endTimeSeconds: number;
  chatMessages?: ChatQuote[];
  transcriptText?: string | null;
  eventSummary?: string | null;
  audioSummary?: string | null;
  hypeHits?: string[];
}

const HOOK_PATTERNS: RegExp[] = [
  /\b(oh my god|omg|no way|what the|holy\b|insane|bro+|dude|clip that|are you kidding|i can't|i cant|let'?s go|we got|he got|she got|they got|clutch|rage|died|won|lose|lost|gg)\b[^.]{0,40}/i,
  /[^.!?]{8,70}[!?]/,
  /"[^"]{8,60}"/,
];

/** Pull a short, punchy hook from transcript — not a random mid-sentence slice. */
export function extractClipHook(transcriptText: string | null | undefined): string | null {
  if (!transcriptText) return null;
  const cleaned = transcriptText
    .replace(/\[silence\]/gi, " ")
    .replace(/\[processing error\]/gi, " ")
    .replace(/\[Live transcript[^\]]*\]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length < 12 || cleaned.includes("placeholder")) return null;

  for (const pattern of HOOK_PATTERNS) {
    const match = cleaned.match(pattern);
    if (match?.[0]) {
      return tidyTitle(match[0]);
    }
  }

  // Prefer a full sentence/clause near the middle (usually the peak).
  const sentences = cleaned
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 16 && s.length <= 90);
  if (sentences.length > 0) {
    const mid = sentences[Math.floor(sentences.length / 2)]!;
    return tidyTitle(mid);
  }

  // Fall back to a clean word window, never a mid-word cut.
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length < 4) return tidyTitle(cleaned.slice(0, 60));
  const start = Math.max(0, Math.floor(words.length * 0.25));
  const slice = words.slice(start, start + 10).join(" ");
  return tidyTitle(slice);
}

function tidyTitle(raw: string): string {
  let t = raw.replace(/^["'\s]+|["'\s]+$/g, "").replace(/\s+/g, " ").trim();
  // Drop leading filler words.
  t = t.replace(/^(um+|uh+|like|so|and|but|okay|ok|yeah|well)\b[,:]?\s+/i, "");
  if (!t) return "Stream moment";
  // Title-case lightly for Shorts-style hooks when all lowercase.
  if (t === t.toLowerCase() && t.length <= 48) {
    t = t.replace(/\b([a-z])/g, (m) => m.toUpperCase());
  }
  if (t.length > 64) t = t.slice(0, 64).replace(/\s+\S*$/, "").trim();
  return t;
}

/** Build a specific clip title from real stream signals — not generic labels. */
export function buildSpecificClipTitle(input: BuildClipCopyInput): string {
  const { chatMessages, transcriptText, hypeHits, eventSummary, audioSummary, startTimeSeconds } =
    input;

  if (chatMessages?.length) {
    const best = pickBestChatLine(chatMessages);
    if (best) {
      const short = tidyTitle(best.messageText);
      if (short.length >= 8) return short;
    }
  }

  const hook = extractClipHook(transcriptText);
  if (hook) return hook;

  if (eventSummary && eventSummary.trim().length > 8) {
    return tidyTitle(eventSummary);
  }

  if (audioSummary && audioSummary.trim().length > 8) {
    return tidyTitle(audioSummary);
  }

  if (hypeHits?.length) {
    return `Chat loses it: “${hypeHits.slice(0, 2).join('", "')}”`;
  }

  return `Peak moment · ${formatSeconds(startTimeSeconds)}`;
}

function cleanPublishableContext(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/\[(?:silence|processing error|live transcript[^\]]*)\]/gi, " ")
    .replace(/\bGreat\s+\d+s\s+Short candidate at\s+\d{1,3}:\d{2}(?::\d{2})?\.?/gi, " ")
    .replace(/^(?:Hook line|Audio|Hype spike|Chat reacted hard):\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Build public-facing context for the clip, never internal scoring copy. */
export function buildSpecificClipReason(input: BuildClipCopyInput): string {
  const {
    chatMessages,
    transcriptText,
    eventSummary,
    audioSummary,
    hypeHits,
  } = input;
  const transcript = cleanPublishableContext(transcriptText);
  const transcriptSentences = transcript
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 18 && sentence.length <= 240);
  const transcriptSummary = transcriptSentences.slice(0, 2).join(" ").slice(0, 420);
  if (transcriptSummary) return transcriptSummary;

  const hook = extractClipHook(transcript);
  const supportingContext = [eventSummary, audioSummary]
    .map(cleanPublishableContext)
    .find((value) => value.length >= 18);
  if (hook && supportingContext && !supportingContext.includes(hook)) {
    return `${hook}. ${supportingContext}`.slice(0, 420);
  }
  if (supportingContext) return supportingContext.slice(0, 420);
  if (hook) return `${hook}.`.replace(/\.\.$/, ".");

  const chatLine = chatMessages?.map((message) => cleanPublishableContext(message.messageText))
    .find((value) => value.length >= 12);
  if (chatLine) return chatLine.slice(0, 280);
  const hypeLine = hypeHits?.map(cleanPublishableContext).find(Boolean);
  if (hypeLine) return hypeLine.slice(0, 280);
  return "A complete standout moment with the setup and payoff intact.";
}

function pickBestChatLine(messages: ChatQuote[]): ChatQuote | null {
  const scored = messages
    .filter((m) => m.messageText.trim().length > 2)
    .map((m) => {
      const t = m.messageText.toLowerCase();
      let score = Math.min(40, m.messageText.length);
      if (t.includes("clip")) score += 20;
      if (t.includes("omg") || t.includes("wtf") || t.includes("no way")) score += 15;
      if (t.includes("goal") || t.includes("insane") || t.includes("crazy")) score += 10;
      if (m.messageText === m.messageText.toUpperCase() && m.messageText.length > 4)
        score += 8;
      return { m, score };
    })
    .sort((a, b) => b.score - a.score);

  return scored[0]?.m ?? messages[0] ?? null;
}

/** Score how clip-worthy a transcript window is (higher = better Short). */
export function scoreTranscriptClipWorthiness(text: string): number {
  const t = text.toLowerCase();
  if (t.length < 20) return 0;
  let score = Math.min(20, t.split(/\s+/).length);
  const hits = [
    [/omg|oh my god|wtf|no way|holy|insane|crazy|bro+|dude/g, 8],
    [/clip|clip that|clip it/g, 12],
    [/clutch|rage|died|gg|let'?s go|we won|i won/g, 10],
    [/[!?]{1,}/g, 3],
    [/lol|lmao|haha/g, 4],
  ] as const;
  for (const [re, pts] of hits) {
    const m = t.match(re);
    if (m) score += pts * Math.min(3, m.length);
  }
  return score;
}

export function clipLengthFromMoment(
  start: number,
  end: number,
  padding = 5
): { start: number; end: number } {
  const core = Math.max(15, end - start + padding * 2);
  const len = Math.min(60, Math.max(20, core));
  return {
    start: Math.max(0, start - padding),
    end: Math.max(0, start - padding) + len,
  };
}
