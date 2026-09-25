import { prisma } from "@/lib/db";
import { selectLatestFinalRenderJob } from "@/lib/renderJobSelection";

const FINAL_RENDER_LOOKBACK = 50;

export async function getLatestCompletedFinalRenderJob(
  clipSuggestionId: string
) {
  for (let skip = 0; ; skip += FINAL_RENDER_LOOKBACK) {
    const jobs = await prisma.renderJob.findMany({
      where: {
        clipSuggestionId,
        status: "completed",
        outputPath: { not: null },
      },
      orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      skip,
      take: FINAL_RENDER_LOOKBACK,
    });

    const general = selectLatestFinalRenderJob(jobs);
    if (general || jobs.length < FINAL_RENDER_LOOKBACK) return general;
  }
}
