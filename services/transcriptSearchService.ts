import { prisma } from "@/lib/db";
import type { RagSearchResult } from "@/lib/rag";

/** Keyword search over Whisper transcript chunks (fallback when vector similarity is weak). */
export async function keywordTranscriptSearch(
  streamSessionId: string,
  query: string,
  limit = 12
): Promise<RagSearchResult[]> {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^\w'-]/g, ""))
    .filter((w) => w.length > 3);

  if (words.length === 0) return [];

  const chunks = await prisma.transcriptChunk.findMany({
    where: {
      streamSessionId,
      NOT: {
        text: { in: ["[silence]", "[processing error]"] },
      },
      OR: words.slice(0, 6).map((word) => ({
        text: { contains: word, mode: "insensitive" as const },
      })),
    },
    orderBy: { startTimeSeconds: "asc" },
    take: limit,
  });

  return chunks
    .filter((c) => c.text.trim().length > 0)
    .map((c) => ({
      id: c.id,
      sourceType: "transcript" as const,
      startTimeSeconds: c.startTimeSeconds,
      endTimeSeconds: c.endTimeSeconds,
      text: c.text,
      score: 0,
      similarity: 0.32,
    }));
}
