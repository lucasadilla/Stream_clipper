import { prisma } from "@/lib/db";
import { fileExists } from "@/lib/storage";
/** Reuse only the identical immutable request with a file still on disk. */
export async function findCompletedRenderForSpec(streamSessionId: string, clipSuggestionId: string | undefined, specHash: string): Promise<string | null> {
  const candidates = await prisma.renderJob.findMany({ where: { streamSessionId, clipSuggestionId: clipSuggestionId ?? null,
    status: "completed", outputPath: { not: null }, params: { path: ["renderSpecHash"], equals: specHash } },
    orderBy: { completedAt: "desc" }, take: 8, select: { id: true, outputPath: true } });
  return candidates.find(candidate => candidate.outputPath && fileExists(candidate.outputPath))?.id || null;
}
