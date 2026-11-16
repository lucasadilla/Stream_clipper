import { randomUUID } from "crypto";
import { prisma } from "@/lib/db";

/** Serialize a publishing transition against Trash/purge without changing existing posting consent. */
export async function withActiveLibraryClip<T>(clipId: string, operation: () => Promise<T>): Promise<T> {
  const item = await prisma.clipLibraryItem.findUnique({ where: { id: clipId }, select: { id: true, deletedAt: true, purgedAt: true } });
  if (!item) return operation();
  if (item.deletedAt || item.purgedAt) throw new Error("Restore this clip from My Clips before posting it.");
  const lease = randomUUID();
  const claimed = await prisma.clipLibraryItem.updateMany({ where: { id: clipId, deletedAt: null, purgedAt: null,
    OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date() } }] }, data: { lockedBy: lease, lockedUntil: new Date(Date.now() + 300_000) } });
  if (!claimed.count) throw new Error("This clip is being saved or updated. Try again shortly.");
  try { return await operation(); }
  finally { await prisma.clipLibraryItem.updateMany({ where: { id: clipId, lockedBy: lease }, data: { lockedBy: null, lockedUntil: null } }); }
}
