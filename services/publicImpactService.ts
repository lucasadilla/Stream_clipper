import { randomUUID } from "crypto";
import { prisma } from "@/lib/db";
import { safeViewCount, utcDay, type PublicImpact } from "@/lib/publicLanding";
import { fetchPostMetrics } from "@/services/social/socialPerformanceService";
import { getPublisherContext } from "@/services/social/socialConnectionService";

const ID = "landing";
// Facebook's existing connection does not grant video insights. Never count likes or impressions as views.
const PLATFORMS = ["youtube", "tiktok", "instagram", "x"];
export const EMPTY_PUBLIC_IMPACT: PublicImpact = { totalViews: null, countedPosts: 0, knownPosts: 0, refreshedAt: null };

/** Public reads never call provider APIs or expose account/post identities. */
export async function getPublicImpact(options: { strict?: boolean } = {}): Promise<PublicImpact> {
  try {
    const row = await prisma.publicImpactSnapshot.findUnique({ where: { id: ID } });
    return row ? { totalViews: row.totalViews?.toString() ?? null, countedPosts: row.countedPosts, knownPosts: row.knownPosts, refreshedAt: row.refreshedAt?.toISOString() ?? null } : EMPTY_PUBLIC_IMPACT;
  } catch (error) { if (options.strict) throw error; return EMPTY_PUBLIC_IMPACT; }
}

/** Durable UTC-day cursor + lease: restart-safe, bounded provider traffic, no AI. */
export async function refreshPublicImpactBatch(now = new Date()): Promise<boolean> {
  const day = utcDay(now);
  await prisma.publicImpactSnapshot.upsert({ where: { id: ID }, create: { id: ID, day }, update: {} });
  const lease = randomUUID();
  const claimed = await prisma.publicImpactSnapshot.updateMany({ where: { id: ID, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
    AND: [{ OR: [{ day: { lt: day } }, { phase: { not: "complete" } }] }] }, data: { lockedBy: lease, lockedUntil: new Date(now.getTime() + 300_000) } });
  if (!claimed.count) return false;
  const heartbeat = setInterval(() => {
    void prisma.publicImpactSnapshot.updateMany({ where: { id: ID, lockedBy: lease }, data: { lockedUntil: new Date(Date.now() + 300_000) } }).catch(() => undefined);
  }, 30_000);
  heartbeat.unref();
  try {
    let state = await prisma.publicImpactSnapshot.findUniqueOrThrow({ where: { id: ID } });
    if (state.day < day) state = await prisma.publicImpactSnapshot.update({ where: { id: ID, lockedBy: lease }, data: { day, phase: "discover", cursor: null } });
    if (state.phase === "discover") {
      const jobs = await prisma.socialPublishJob.findMany({ where: { status: "completed", platformPostId: { not: null }, connectedSocialAccount: { isActive: true }, ...(state.cursor ? { id: { gt: state.cursor } } : {}) },
        orderBy: { id: "asc" }, take: 100, select: { id: true, connectedSocialAccountId: true, platform: true, platformPostId: true, completedAt: true, createdAt: true } });
      await prisma.publicPostMetric.createMany({ data: jobs.map(job => ({ connectedSocialAccountId: job.connectedSocialAccountId, platform: job.platform, platformPostId: job.platformPostId!, publishedAt: job.completedAt || job.createdAt })), skipDuplicates: true });
      await prisma.publicImpactSnapshot.update({ where: { id: ID, lockedBy: lease }, data: { cursor: jobs.at(-1)?.id ?? state.cursor, ...(jobs.length < 100 ? { phase: "metrics" } : {}) } });
      return true;
    }
    const rows = await prisma.publicPostMetric.findMany({ where: { connectedSocialAccount: { isActive: true }, OR: [{ attemptedAt: null }, { attemptedAt: { lt: state.day } }] }, orderBy: { id: "asc" }, take: 4,
      include: { connectedSocialAccount: { select: { grantedScopes: true } } } });
    // Four at most, two concurrent. This timer is independent of the render worker queue.
    for (let offset = 0; offset < rows.length; offset += 2) await Promise.all(rows.slice(offset, offset + 2).map(async row => {
      let views: bigint | null = null;
      try {
        if (PLATFORMS.includes(row.platform)) {
          const metrics = await fetchPostMetrics(row.platform, row.platformPostId, await getPublisherContext(row.connectedSocialAccountId), row.publishedAt, row.connectedSocialAccount.grantedScopes, { viewsOnly: true });
          views = safeViewCount(metrics.views);
        }
      } catch { /* Preserve the last known count; retry on the next daily run. */ }
      await prisma.publicPostMetric.update({ where: { id: row.id }, data: { attemptedAt: now, ...(views !== null ? { views, fetchedAt: new Date() } : {}) } });
    }));
    if (rows.length) return true;
    const [totals, knownPosts] = await Promise.all([
      prisma.publicPostMetric.aggregate({ where: { views: { not: null } }, _sum: { views: true }, _count: { id: true }, _max: { fetchedAt: true } }),
      prisma.publicPostMetric.count(),
    ]);
    await prisma.publicImpactSnapshot.update({ where: { id: ID, lockedBy: lease }, data: { phase: "complete", totalViews: totals._sum.views, countedPosts: totals._count.id, knownPosts, refreshedAt: totals._max.fetchedAt ?? state.refreshedAt } });
    return false;
  } finally {
    clearInterval(heartbeat);
    await prisma.publicImpactSnapshot.updateMany({ where: { id: ID, lockedBy: lease }, data: { lockedBy: null, lockedUntil: null } });
  }
}

let started = false;
export function startPublicImpactPoller() {
  if (started) return;
  started = true;
  const tick = async () => {
    let more = false;
    try { more = await refreshPublicImpactBatch(); } catch { console.warn("[landing] Daily view refresh deferred; previous snapshot remains available."); }
    const timer = setTimeout(() => void tick(), more ? 1000 : 60_000);
    timer.unref();
  };
  const timer = setTimeout(() => void tick(), 10_000);
  timer.unref();
}
