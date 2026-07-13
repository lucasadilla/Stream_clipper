import { prisma } from "@/lib/db";
import { getPricingPlan } from "@/lib/pricing";
import { deleteStreamSession } from "@/services/sessionCleanupService";

export interface RetentionCleanupResult {
  scanned: number;
  deleted: number;
  freedBytes: number;
  errors: string[];
}

/**
 * Delete sessions older than each billing account's plan retention window.
 * Accounts with null retention (Business / unlimited) are skipped.
 */
export async function runRetentionCleanup(
  options: { limit?: number } = {}
): Promise<RetentionCleanupResult> {
  const limit = options.limit ?? 10;
  const accounts = await prisma.billingAccount.findMany({
    select: { id: true, plan: true, unlimitedAccess: true },
  });

  const result: RetentionCleanupResult = {
    scanned: 0,
    deleted: 0,
    freedBytes: 0,
    errors: [],
  };

  const candidates: Array<{ id: string; createdAt: Date }> = [];

  for (const account of accounts) {
    if (account.unlimitedAccess) continue;
    const entitlements = getPricingPlan(account.plan).entitlements;
    const days = entitlements.storageRetentionDays;
    if (days === null) continue;

    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const sessions = await prisma.streamSession.findMany({
      where: {
        billingAccountId: account.id,
        createdAt: { lt: cutoff },
      },
      orderBy: { createdAt: "asc" },
      take: limit,
      select: { id: true, createdAt: true },
    });
    candidates.push(...sessions);
  }

  // Also clean orphan sessions with no billing account older than Creator retention.
  const orphanCutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const orphans = await prisma.streamSession.findMany({
    where: {
      billingAccountId: null,
      createdAt: { lt: orphanCutoff },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true, createdAt: true },
  });
  candidates.push(...orphans);

  candidates.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const toDelete = candidates.slice(0, limit);
  result.scanned = toDelete.length;

  for (const session of toDelete) {
    try {
      const deleted = await deleteStreamSession(session.id);
      result.deleted += 1;
      result.freedBytes += deleted.freedBytes;
    } catch (err) {
      result.errors.push(
        `${session.id}: ${err instanceof Error ? err.message : "delete failed"}`
      );
    }
  }

  return result;
}

/** Total on-disk-ish storage for an account via SourceMedia.sizeBytes (all time). */
export async function getAccountStoredMediaBytes(
  billingAccountId: string
): Promise<number> {
  const media = await prisma.sourceMedia.findMany({
    where: { streamSession: { billingAccountId } },
    select: { sizeBytes: true },
  });
  return media.reduce((sum, row) => {
    const n =
      typeof row.sizeBytes === "bigint"
        ? Number(row.sizeBytes)
        : Number(row.sizeBytes ?? 0);
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);
}
