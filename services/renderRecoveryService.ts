import { prisma } from "@/lib/db";
import { appendRenderJobLog } from "@/lib/renderJobLogs";

export async function reclaimStaleRenderJobs(staleAfterMs = 5 * 60_000): Promise<number> {
  const cutoff = new Date(Date.now() - staleAfterMs);
  const stale = await prisma.renderJob.findMany({
    where: {
      status: "processing",
      OR: [{ lockedAt: { lt: cutoff } }, { lockedAt: null, updatedAt: { lt: cutoff } }],
    },
    select: { id: true, attempts: true, maxAttempts: true },
    take: 20,
  });

  let reclaimed = 0;
  for (const job of stale) {
    const nextStatus = job.attempts >= job.maxAttempts ? "failed" : "queued";
    const claimed = await prisma.renderJob.updateMany({
      where: { id: job.id, status: "processing", OR: [{ lockedAt: { lt: cutoff } }, { lockedAt: null, updatedAt: { lt: cutoff } }] },
      data: {
        status: nextStatus,
        lockedAt: null,
        lockedBy: null,
        errorMessage:
          nextStatus === "failed"
            ? "Render timed out or worker restarted too many times"
            : null,
      },
    });
    if (claimed.count !== 1) continue;
    await appendRenderJobLog(
      job.id,
      "reclaimed_after_restart",
      nextStatus === "failed"
        ? "Gave up after stale lock"
        : "Re-queued after stale processing lock",
      nextStatus === "failed" ? "error" : "warn"
    );
    reclaimed += 1;
  }
  return reclaimed;
}
