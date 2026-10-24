import { randomUUID } from "crypto";
import { prisma } from "@/lib/db";
import { safeViewCount, utcDay, type PublicImpact } from "@/lib/publicLanding";
import { emptyAccountViewScan, parseAccountViewScan, fetchAccountViewsPage } from "@/services/social/accountViewsService";
import { getPublisherContext } from "@/services/social/socialConnectionService";

const ID = "landing-accounts";
export const EMPTY_PUBLIC_IMPACT: PublicImpact = { totalViews: null, countedAccounts: 0, knownAccounts: 0, refreshedAt: null };

/** Stored account totals only. A page visit never queries a social platform. */
export async function getPublicImpact(options: { strict?: boolean } = {}): Promise<PublicImpact> {
  try {
    const row = await prisma.publicImpactSnapshot.findUnique({ where: { id: ID } });
    return row ? { totalViews: row.totalViews?.toString() ?? null, countedAccounts: row.countedAccounts, knownAccounts: row.knownAccounts, refreshedAt: row.refreshedAt?.toISOString() ?? null } : EMPTY_PUBLIC_IMPACT;
  } catch (error) { if (options.strict) throw error; return EMPTY_PUBLIC_IMPACT; }
}

/** Daily UTC sweep, with durable per-account pagination and an independent timer. */
export async function refreshPublicImpactBatch(now = new Date()): Promise<boolean> {
  const day = utcDay(now);
  await prisma.publicImpactSnapshot.upsert({ where: { id: ID }, create: { id: ID, day }, update: {} });
  const lease = randomUUID();
  const claimed = await prisma.publicImpactSnapshot.updateMany({ where: { id: ID,
    OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
    AND: [{ OR: [{ day: { lt: day } }, { phase: { not: "complete" } }] }],
  }, data: { lockedBy: lease, lockedUntil: new Date(now.getTime() + 300_000) } });
  if (!claimed.count) return false;
  const heartbeat = setInterval(() => {
    void prisma.publicImpactSnapshot.updateMany({ where: { id: ID, lockedBy: lease }, data: { lockedUntil: new Date(Date.now() + 300_000) } }).catch(() => undefined);
  }, 30_000);
  heartbeat.unref();
  try {
    let state = await prisma.publicImpactSnapshot.findUniqueOrThrow({ where: { id: ID, lockedBy: lease } });
    if (state.day < day) state = await prisma.publicImpactSnapshot.update({ where: { id: ID, lockedBy: lease }, data: { day, phase: "discover", cursor: null } });
    if (state.phase === "discover") {
      const accounts = await prisma.connectedSocialAccount.findMany({ where: { isActive: true, ...(state.cursor ? { id: { gt: state.cursor } } : {}) },
        orderBy: { id: "asc" }, take: 100, select: { id: true, platform: true, platformAccountId: true } });
      await prisma.publicAccountMetric.createMany({ data: accounts.map(account => ({ platform: account.platform, platformAccountId: account.platformAccountId })), skipDuplicates: true });
      await prisma.publicImpactSnapshot.update({ where: { id: ID, lockedBy: lease }, data: { cursor: accounts.at(-1)?.id ?? state.cursor, ...(accounts.length < 100 ? { phase: "metrics" } : {}) } });
      return true;
    }
    const rows = await prisma.publicAccountMetric.findMany({ where: { OR: [{ attemptedAt: null }, { attemptedAt: { lt: state.day } }] }, orderBy: { id: "asc" }, take: 2 });
    await Promise.all(rows.map(async row => {
      const account = await prisma.connectedSocialAccount.findFirst({ where: { platform: row.platform, platformAccountId: row.platformAccountId, isActive: true }, orderBy: { updatedAt: "desc" }, select: { id: true, platform: true, platformAccountId: true, grantedScopes: true } });
      if (!account) {
        await prisma.publicAccountMetric.update({ where: { id: row.id }, data: { attemptedAt: now } });
        return;
      }
      const scan = row.scanDay?.getTime() === state.day.getTime() ? parseAccountViewScan(row.scanState) : emptyAccountViewScan();
      try {
        const page = await fetchAccountViewsPage(account, await getPublisherContext(account.id), scan);
        const total = BigInt(scan.total) + page.views;
        await prisma.publicAccountMetric.update({ where: { id: row.id }, data: page.cursor ? {
          scanDay: state.day, scanState: { cursor: page.cursor, total: total.toString(), seen: page.seen, pages: scan.pages + 1, items: scan.items + page.items },
        } : { views: total, fetchedAt: new Date(), attemptedAt: now, scanDay: state.day, scanState: {} } });
      } catch {
        // A partial history is never published as an account total. Keep the previous complete count.
        await prisma.publicAccountMetric.update({ where: { id: row.id }, data: { attemptedAt: now, scanState: {} } });
      }
    }));
    if (rows.length) return true;
    // EXISTS deduplicates an account connected by multiple users and excludes disconnected accounts.
    const [totals] = await prisma.$queryRaw<Array<{ totalViews: string | null; countedAccounts: bigint; knownAccounts: bigint; refreshedAt: Date | null }>>`
      SELECT SUM(m.views)::text AS "totalViews", COUNT(m.views) AS "countedAccounts", COUNT(*) AS "knownAccounts", MAX(m."fetchedAt") AS "refreshedAt"
      FROM "PublicAccountMetric" m
      WHERE EXISTS (SELECT 1 FROM "ConnectedSocialAccount" a WHERE a.platform = m.platform AND a."platformAccountId" = m."platformAccountId" AND a."isActive" = true)
    `;
    const known = Number(totals.knownAccounts);
    await prisma.publicImpactSnapshot.update({ where: { id: ID, lockedBy: lease }, data: { phase: "complete", totalViews: known === 0 ? BigInt(0) : safeViewCount(totals.totalViews),
      countedAccounts: Number(totals.countedAccounts), knownAccounts: known, refreshedAt: totals.refreshedAt ?? state.refreshedAt } });
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
    try { more = await refreshPublicImpactBatch(); } catch { console.warn("[landing] Daily account view refresh deferred; previous total remains available."); }
    const timer = setTimeout(() => void tick(), more ? 1000 : 60_000);
    timer.unref();
  };
  const timer = setTimeout(() => void tick(), 10_000);
  timer.unref();
}
