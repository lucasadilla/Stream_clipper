import { prisma } from "@/lib/db";
import { selectLatestFinalRenderJob } from "@/lib/renderJobSelection";

const FINAL_RENDER_LOOKBACK = 50;

export async function getLatestCompletedFinalRenderJob(
  clipSuggestionId: string
) {
  const jobs = await prisma.renderJob.findMany({
    where: {
      clipSuggestionId,
      status: "completed",
      outputPath: { not: null },
    },
    orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
    take: FINAL_RENDER_LOOKBACK,
  });

  return selectLatestFinalRenderJob(jobs);
}
