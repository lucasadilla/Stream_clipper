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

/** Build a specific clip title from real stream signals — not generic labels. */
export function buildSpecificClipTitle(input: BuildClipCopyInput): string {
  const { chatMessages, transcriptText, hypeHits, startTimeSeconds } = input;

  if (chatMessages?.length) {
    const best = pickBestChatLine(chatMessages);
    if (best) {
      const short = best.messageText.trim().slice(0, 55);
      return short.length < best.messageText.trim().length ? `${short}…` : short;
    }
  }

  if (transcriptText && !transcriptText.includes("[Live transcript") && !transcriptText.includes("placeholder")) {
    const t = transcriptText.trim().slice(0, 55);
    return t.length < transcriptText.trim().length ? `${t}…` : t;
  }

  if (hypeHits?.length) {
    return `Chat yells "${hypeHits.slice(0, 2).join('", "')}" at ${formatSeconds(startTimeSeconds)}`;
  }

  return `Moment at ${formatSeconds(startTimeSeconds)}`;
}

/** Build a specific reason citing chat quotes and what happened. */
export function buildSpecificClipReason(input: BuildClipCopyInput): string {
  const parts: string[] = [];
  const { startTimeSeconds, endTimeSeconds, chatMessages, transcriptText, eventSummary, audioSummary, hypeHits } = input;

  parts.push(`At ${formatSeconds(startTimeSeconds)}–${formatSeconds(endTimeSeconds)}:`);

  if (chatMessages?.length) {
    const quotes = chatMessages
      .slice(0, 4)
      .map((m) => `"${m.messageText.trim().slice(0, 80)}"${m.authorName ? ` (${m.authorName})` : ""}`);
    parts.push(`Chat said ${quotes.join(", ")}.`);
  } else if (hypeHits?.length) {
    parts.push(`Chat spiked with ${hypeHits.map((h) => `"${h}"`).join(", ")}.`);
  }

  if (transcriptText && !transcriptText.includes("placeholder")) {
    parts.push(`Stream audio/transcript: "${transcriptText.trim().slice(0, 120)}".`);
  }

  if (audioSummary && !parts.some((p) => p.includes("loud"))) {
    parts.push(audioSummary);
  }

  if (eventSummary && parts.length < 3) {
    parts.push(eventSummary);
  }

  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function pickBestChatLine(messages: ChatQuote[]): ChatQuote | null {
  const scored = messages
    .filter((m) => m.messageText.trim().length > 2)
    .map((m) => {
      const t = m.messageText.toLowerCase();
      let score = m.messageText.length;
      if (t.includes("clip")) score += 20;
      if (t.includes("omg") || t.includes("wtf") || t.includes("no way")) score += 15;
      if (t.includes("goal") || t.includes("insane") || t.includes("crazy")) score += 10;
      if (m.messageText === m.messageText.toUpperCase() && m.messageText.length > 4) score += 8;
      return { m, score };
    })
    .sort((a, b) => b.score - a.score);

  return scored[0]?.m ?? messages[0] ?? null;
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
