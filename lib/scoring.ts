export const HYPE_WORDS = [
  "lol",
  "lmao",
  "haha",
  "wtf",
  "omg",
  "no way",
  "clip",
  "clip it",
  "insane",
  "crazy",
  "w",
  "bro",
  "what",
  "yooo",
  "dead",
  "crying",
  "nah",
] as const;

const EMOJI_REGEX =
  /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu;

export interface ChatMessageForScoring {
  authorName: string;
  authorChannelId?: string | null;
  messageText: string;
  videoTimeSeconds?: number | null;
}

export interface WindowMetrics {
  messageCount: number;
  uniqueChatterCount: number;
  hypeWordCount: number;
  clipItCount: number;
  allCapsCount: number;
  emojiCount: number;
  repeatedWordCount: number;
  score: number;
  topMessages: string[];
  hypeHits: string[];
}

function countEmojis(text: string): number {
  const matches = text.match(EMOJI_REGEX);
  return matches?.length ?? 0;
}

function isMostlyCaps(text: string): boolean {
  const letters = text.replace(/[^a-zA-Z]/g, "");
  if (letters.length < 4) return false;
  const caps = letters.replace(/[^A-Z]/g, "").length;
  return caps / letters.length > 0.7;
}

function countRepeatedWords(messages: string[]): number {
  const wordCounts = new Map<string, number>();
  for (const msg of messages) {
    const words = msg.toLowerCase().split(/\s+/).filter(Boolean);
    for (const word of words) {
      if (word.length < 3) continue;
      wordCounts.set(word, (wordCounts.get(word) ?? 0) + 1);
    }
  }
  let repeated = 0;
  for (const count of wordCounts.values()) {
    if (count >= 3) repeated += count;
  }
  return repeated;
}

export function scoreChatWindow(messages: ChatMessageForScoring[]): WindowMetrics {
  const authors = new Set<string>();
  let hypeWordCount = 0;
  let clipItCount = 0;
  let allCapsCount = 0;
  let emojiCount = 0;
  const hypeHits: string[] = [];
  const texts: string[] = [];

  for (const msg of messages) {
    authors.add(msg.authorChannelId ?? msg.authorName);
    const lower = msg.messageText.toLowerCase();
    texts.push(msg.messageText);

    for (const word of HYPE_WORDS) {
      if (lower.includes(word)) {
        hypeWordCount++;
        if (!hypeHits.includes(word)) hypeHits.push(word);
      }
    }

    if (lower.includes("clip it") || lower.includes("clip this")) {
      clipItCount++;
    }

    if (isMostlyCaps(msg.messageText)) allCapsCount++;
    emojiCount += countEmojis(msg.messageText);
  }

  const messageCount = messages.length;
  const uniqueChatterCount = authors.size;
  const repeatedWordCount = countRepeatedWords(texts);

  // Weighted scoring formula
  const score =
    messageCount * 0.5 +
    uniqueChatterCount * 1.5 +
    hypeWordCount * 2 +
    clipItCount * 5 +
    allCapsCount * 1.5 +
    emojiCount * 0.5 +
    repeatedWordCount * 0.3;

  const topMessages = texts.slice(0, 5);

  return {
    messageCount,
    uniqueChatterCount,
    hypeWordCount,
    clipItCount,
    allCapsCount,
    emojiCount,
    repeatedWordCount,
    score,
    topMessages,
    hypeHits,
  };
}

export function buildChatWindowSummary(
  startTimeSeconds: number,
  endTimeSeconds: number,
  metrics: WindowMetrics
): string {
  const start = formatTimeLabel(startTimeSeconds);
  const end = formatTimeLabel(endTimeSeconds);

  if (metrics.score < 5) {
    return `From ${start} to ${end}, chat activity was low (${metrics.messageCount} messages).`;
  }

  const hypePart =
    metrics.hypeHits.length > 0
      ? `Many users said '${metrics.hypeHits.slice(0, 3).join("', '")}'.`
      : "Chat activity increased noticeably.";

  const clipPart =
    metrics.clipItCount > 0
      ? " Several viewers asked to clip this moment."
      : "";

  const intensity =
    metrics.score > 30
      ? "heavily"
      : metrics.score > 15
        ? "significantly"
        : "moderately";

  return `From ${start} to ${end}, chat activity spiked ${intensity}. ${hypePart}${clipPart} This is likely a funny or hype moment.`;
}

function formatTimeLabel(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}
