import { prisma } from "@/lib/db";
import type { RagSearchResult } from "@/lib/rag";
import { estimateTimeInSpeechWindow } from "@/lib/transcriptTiming";

const STOP_WORDS = new Set([
  "when",
  "what",
  "where",
  "which",
  "who",
  "how",
  "why",
  "does",
  "did",
  "was",
  "were",
  "are",
  "about",
  "that",
  "this",
  "with",
  "from",
  "have",
  "they",
  "them",
  "their",
  "there",
  "then",
  "than",
  "just",
  "like",
  "would",
  "could",
  "should",
  "mention",
  "mentioned",
  "time",
  "timestamp",
  "moment",
  "happened",
  "happen",
  "said",
  "says",
  "talk",
  "talking",
  "find",
  "show",
  "tell",
  "stream",
  "video",
  "clip",
  "point",
]);

/** Questions asking for a specific moment need GPT — keyword fast path is too naive. */
export function isTemporalQuestion(message: string): boolean {
  return /\b(when|what time|at what point|which minute|how long ago|timestamp)\b/i.test(
    message
  );
}

function extractSearchTerms(query: string): string[] {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^\w'-]/g, ""))
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

  if (terms.length > 0) return terms;

  return query
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^\w'-]/g, ""))
    .filter((w) => w.length >= 4);
}

function scoreChunk(text: string, terms: string[]): number {
  const lower = text.toLowerCase();
  let score = 0;

  for (const term of terms) {
    if (lower.includes(term)) score += 1;
  }

  for (let i = 0; i < terms.length - 1; i++) {
    const phrase = `${terms[i]} ${terms[i + 1]}`;
    if (lower.includes(phrase)) score += 2;
  }

  return score;
}

function relevanceFromScore(score: number, termCount: number): number {
  if (score <= 0 || termCount <= 0) return 0;
  return Math.min(0.92, 0.15 + (score / termCount) * 0.45 + score * 0.05);
}

export function estimateTimestampInChunk(
  text: string,
  startSeconds: number,
  endSeconds: number,
  query: string
): number {
  return estimateTimeInSpeechWindow(
    text,
    startSeconds,
    endSeconds,
    query,
    (lower, q) => {
      const terms = extractSearchTerms(q);
      let earliestIdx = -1;
      for (const term of terms) {
        const idx = lower.indexOf(term);
        if (idx >= 0 && (earliestIdx < 0 || idx < earliestIdx)) earliestIdx = idx;
      }
      return earliestIdx;
    }
  );
}
export async function keywordTranscriptSearch(
  streamSessionId: string,
  query: string,
  limit = 12
): Promise<RagSearchResult[]> {
  const terms = extractSearchTerms(query);
  if (terms.length === 0) return [];

  const chunks = await prisma.transcriptChunk.findMany({
    where: {
      streamSessionId,
      NOT: {
        text: { in: ["[silence]", "[processing error]"] },
      },
      OR: terms.slice(0, 8).map((word) => ({
        text: { contains: word, mode: "insensitive" as const },
      })),
    },
    take: 80,
  });

  return chunks
    .map((c) => {
      const matchScore = scoreChunk(c.text, terms);
      return {
        id: c.id,
        sourceType: "transcript" as const,
        startTimeSeconds: c.startTimeSeconds,
        endTimeSeconds: c.endTimeSeconds,
        text: c.text,
        score: matchScore,
        similarity: relevanceFromScore(matchScore, terms.length),
      };
    })
    .filter((c) => c.score > 0 && c.text.trim().length > 0)
    .sort((a, b) => {
      const scoreDiff = b.score - a.score;
      if (scoreDiff !== 0) return scoreDiff;
      const simDiff = (b.similarity ?? 0) - (a.similarity ?? 0);
      if (simDiff !== 0) return simDiff;
      return (a.startTimeSeconds ?? 0) - (b.startTimeSeconds ?? 0);
    })
    .slice(0, limit);
}
