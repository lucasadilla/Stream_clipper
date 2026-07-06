/** Minimum chat window score to show on the timeline (matches eventWindowService). */
export const CHAT_HYPE_MIN_SCORE = 8;

export type HypeIntensity = "low" | "medium" | "high";

export interface EventWindowInput {
  id: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  type: string;
  summary?: string | null;
  score: number;
  rawData?: unknown;
}

export interface ChatHypeMoment {
  id: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  score: number;
  summary: string;
  hypeHits: string[];
  messageCount: number;
  clipItCount: number;
  intensity: HypeIntensity;
}

interface ChatWindowMetrics {
  hypeHits?: string[];
  messageCount?: number;
  clipItCount?: number;
}

export function hypeIntensity(score: number): HypeIntensity {
  if (score >= 30) return "high";
  if (score >= 15) return "medium";
  return "low";
}

export function buildChatHypeMoments(
  eventWindows: EventWindowInput[],
  minScore = CHAT_HYPE_MIN_SCORE
): ChatHypeMoment[] {
  return eventWindows
    .filter((w) => w.type === "chat_window" && w.score >= minScore)
    .map((w) => {
      const raw = w.rawData as { metrics?: ChatWindowMetrics } | null;
      const metrics = raw?.metrics;
      return {
        id: w.id,
        startTimeSeconds: w.startTimeSeconds,
        endTimeSeconds: w.endTimeSeconds,
        score: w.score,
        summary: w.summary ?? "",
        hypeHits: metrics?.hypeHits ?? [],
        messageCount: metrics?.messageCount ?? 0,
        clipItCount: metrics?.clipItCount ?? 0,
        intensity: hypeIntensity(w.score),
      };
    })
    .sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);
}

/** Cap visible markers on very long streams while keeping the hottest moments. */
export function selectHypeMomentsForTimeline(
  moments: ChatHypeMoment[],
  maxCount = 80
): ChatHypeMoment[] {
  if (moments.length <= maxCount) return moments;
  return [...moments]
    .sort((a, b) => b.score - a.score)
    .slice(0, maxCount)
    .sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);
}

export function formatHypeTooltip(moment: ChatHypeMoment): string {
  const lines = [`Score ${moment.score}`, moment.summary];
  if (moment.hypeHits.length > 0) {
    lines.push(`Hype: ${moment.hypeHits.slice(0, 6).join(", ")}`);
  }
  if (moment.clipItCount > 0) {
    lines.push(`${moment.clipItCount}× "clip it"`);
  }
  lines.push(`${moment.messageCount} messages`);
  return lines.filter(Boolean).join("\n");
}
