import { prisma } from "@/lib/db";
import { createEmbedding, embeddingToSql } from "@/lib/embeddings";

export type RagSourceType =
  | "chat_window"
  | "transcript"
  | "audio"
  | "visual"
  | "metadata"
  | "clip_suggestion";

export interface RagSearchResult {
  id: string;
  sourceType: RagSourceType;
  startTimeSeconds: number | null;
  endTimeSeconds: number | null;
  text: string;
  score: number;
  similarity?: number;
}

export interface RagSearchOptions {
  limit?: number;
  minTimeSeconds?: number;
  maxTimeSeconds?: number;
  includeHighScoringMoments?: boolean;
}

interface VectorRow {
  id: string;
  source_type: string;
  start_time: number | null;
  end_time: number | null;
  text: string;
  score: number;
  similarity: number;
}

export async function searchStreamContext(
  streamSessionId: string,
  query: string,
  options: RagSearchOptions = {}
): Promise<RagSearchResult[]> {
  const {
    limit = 15,
    minTimeSeconds,
    maxTimeSeconds,
    includeHighScoringMoments = true,
  } = options;

  const queryEmbedding = await createEmbedding(query);
  const embeddingSql = embeddingToSql(queryEmbedding);

  const timeFilter =
    minTimeSeconds != null || maxTimeSeconds != null
      ? `AND COALESCE(start_time, 0) >= ${minTimeSeconds ?? 0}
         ${maxTimeSeconds != null ? `AND COALESCE(end_time, start_time, 999999) <= ${maxTimeSeconds}` : ""}`
      : "";

  // Unified vector search across embedded tables
  const vectorResults = await prisma.$queryRawUnsafe<VectorRow[]>(`
    (
      SELECT id, 'chat_window' as source_type, "startTimeSeconds" as start_time,
             "endTimeSeconds" as end_time, COALESCE(summary, '') as text, score,
             1 - (embedding <=> '${embeddingSql}'::vector) as similarity
      FROM "EventWindow"
      WHERE "streamSessionId" = $1 AND embedding IS NOT NULL AND type = 'chat_window'
      ${timeFilter.replace(/start_time/g, '"startTimeSeconds"').replace(/end_time/g, '"endTimeSeconds"')}
      ORDER BY embedding <=> '${embeddingSql}'::vector
      LIMIT ${Math.ceil(limit / 2)}
    )
    UNION ALL
    (
      SELECT id, 'transcript' as source_type, "startTimeSeconds" as start_time,
             "endTimeSeconds" as end_time, text, 0 as score,
             1 - (embedding <=> '${embeddingSql}'::vector) as similarity
      FROM "TranscriptChunk"
      WHERE "streamSessionId" = $1 AND embedding IS NOT NULL
      ${timeFilter.replace(/start_time/g, '"startTimeSeconds"').replace(/end_time/g, '"endTimeSeconds"')}
      ORDER BY embedding <=> '${embeddingSql}'::vector
      LIMIT ${Math.ceil(limit / 2)}
    )
  `, streamSessionId);

  const results: RagSearchResult[] = vectorResults.map((row) => ({
    id: row.id,
    sourceType: row.source_type as RagSourceType,
    startTimeSeconds: row.start_time,
    endTimeSeconds: row.end_time,
    text: row.text,
    score: row.score,
    similarity: row.similarity,
  }));

  // Include high-scoring non-embedded events
  if (includeHighScoringMoments) {
    const [audioEvents, visualEvents, eventWindows] = await Promise.all([
      prisma.audioEvent.findMany({
        where: {
          streamSessionId,
          score: { gte: 5 },
          ...(minTimeSeconds != null && { startTimeSeconds: { gte: minTimeSeconds } }),
          ...(maxTimeSeconds != null && { endTimeSeconds: { lte: maxTimeSeconds } }),
        },
        orderBy: { score: "desc" },
        take: 5,
      }),
      prisma.visualEvent.findMany({
        where: {
          streamSessionId,
          score: { gte: 5 },
          ...(minTimeSeconds != null && { startTimeSeconds: { gte: minTimeSeconds } }),
          ...(maxTimeSeconds != null && { endTimeSeconds: { lte: maxTimeSeconds } }),
        },
        orderBy: { score: "desc" },
        take: 5,
      }),
      prisma.eventWindow.findMany({
        where: {
          streamSessionId,
          score: { gte: 10 },
          ...(minTimeSeconds != null && { startTimeSeconds: { gte: minTimeSeconds } }),
          ...(maxTimeSeconds != null && { endTimeSeconds: { lte: maxTimeSeconds } }),
        },
        orderBy: { score: "desc" },
        take: 5,
      }),
    ]);

    for (const e of audioEvents) {
      if (!results.find((r) => r.id === e.id)) {
        results.push({
          id: e.id,
          sourceType: "audio",
          startTimeSeconds: e.startTimeSeconds,
          endTimeSeconds: e.endTimeSeconds,
          text: e.summary ?? `Audio ${e.type}`,
          score: e.score,
        });
      }
    }
    for (const e of visualEvents) {
      if (!results.find((r) => r.id === e.id)) {
        results.push({
          id: e.id,
          sourceType: "visual",
          startTimeSeconds: e.startTimeSeconds,
          endTimeSeconds: e.endTimeSeconds,
          text: e.summary ?? `Visual ${e.type}`,
          score: e.score,
        });
      }
    }
    for (const e of eventWindows) {
      if (!results.find((r) => r.id === e.id) && e.summary) {
        results.push({
          id: e.id,
          sourceType: "chat_window",
          startTimeSeconds: e.startTimeSeconds,
          endTimeSeconds: e.endTimeSeconds,
          text: e.summary,
          score: e.score,
        });
      }
    }
  }

  // Add session metadata summary
  const session = await prisma.streamSession.findUnique({
    where: { id: streamSessionId },
  });
  if (session?.title) {
    results.push({
      id: session.id,
      sourceType: "metadata",
      startTimeSeconds: null,
      endTimeSeconds: null,
      text: `Stream: ${session.title} by ${session.channelTitle ?? "unknown channel"}. ${session.description?.slice(0, 200) ?? ""}`,
      score: 0,
    });
  }

  // Existing clip suggestions for context
  const clips = await prisma.clipSuggestion.findMany({
    where: { streamSessionId, status: { in: ["suggested", "saved"] } },
    orderBy: { confidence: "desc" },
    take: 5,
  });
  for (const clip of clips) {
    results.push({
      id: clip.id,
      sourceType: "clip_suggestion",
      startTimeSeconds: clip.startTimeSeconds,
      endTimeSeconds: clip.endTimeSeconds,
      text: `${clip.title}: ${clip.reason}`,
      score: clip.confidence * 10,
    });
  }

  // Sort by combined relevance
  return results
    .sort((a, b) => {
      const simA = a.similarity ?? 0;
      const simB = b.similarity ?? 0;
      return simB + b.score * 0.01 - (simA + a.score * 0.01);
    })
    .slice(0, limit);
}

export async function storeEmbedding(
  table: "EventWindow" | "TranscriptChunk",
  id: string,
  embedding: number[]
): Promise<void> {
  const sql = embeddingToSql(embedding);
  await prisma.$executeRawUnsafe(
    `UPDATE "${table}" SET embedding = '${sql}'::vector WHERE id = $1`,
    id
  );
}
