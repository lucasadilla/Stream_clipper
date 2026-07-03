import {
  getAiClient,
  getEmbeddingModel,
} from "@/lib/aiProvider";

const EMBEDDING_DIMENSIONS = 1536;

export async function createEmbedding(text: string): Promise<number[]> {
  const [embedding] = await createEmbeddingsBatch([text]);
  if (!embedding) throw new Error("Failed to create embedding");
  return embedding;
}

export async function createEmbeddingsBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const client = getAiClient();
  const response = await client.embeddings.create({
    model: getEmbeddingModel(),
    input: texts.map((t) => t.slice(0, 8000)),
    dimensions: EMBEDDING_DIMENSIONS,
  });

  return response.data
    .sort((a, b) => a.index - b.index)
    .map((row) => row.embedding);
}

/** Format embedding array for pgvector SQL literal */
export function embeddingToSql(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

export { EMBEDDING_DIMENSIONS };
