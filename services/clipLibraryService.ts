import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { libraryStatus, LIVE_POST_STATUSES } from "@/lib/clipLibrary";
import { requireAuthUserId, SessionAccessError } from "@/services/social/socialAccessService";

export async function libraryAccount(request: Request) {
  const userId = await requireAuthUserId(request);
  const account = await prisma.billingAccount.findUnique({ where: { userId }, select: { id: true } });
  if (!account) throw new SessionAccessError("Account not found", 404);
  return { userId, accountId: account.id };
}
export async function ownedLibraryItem(request: Request, id: string, trash = false) {
  const account = await libraryAccount(request);
  const item = await prisma.clipLibraryItem.findFirst({ where: { id, billingAccountId: account.accountId, purgedAt: null, ...(trash ? {} : { deletedAt: null }) } });
  if (!item) throw new SessionAccessError("Saved clip not found", 404);
  return { ...account, item };
}
const buckets: Record<string, string[]> = {
  publishing: ["queued", "preparing_media", "uploading", "processing", "publishing"], scheduled: ["scheduled"], failed: ["failed", "outcome_unknown"], published: ["completed"],
};
export function libraryStatusWhere(status: string): Prisma.ClipLibraryItemWhereInput {
  const higher: string[] = [];
  for (const [key, statuses] of Object.entries(buckets)) {
    if (key === status) return { AND: [{ publishGroups: { some: { jobs: { some: { status: { in: statuses } } } } } }, { NOT: { publishGroups: { some: { jobs: { some: { status: { in: higher } } } } } } }] };
    higher.push(...statuses);
  }
  if (status === "draft") return { assets: { some: { status: "ready" } }, NOT: { publishGroups: { some: { jobs: { some: { status: { in: higher } } } } } } };
  return {};
}

const itemInclude = {
  assets: { orderBy: { savedAt: "desc" as const } },
  sourceSession: { select: { liveStatus: true } },
  publishGroups: { orderBy: { createdAt: "desc" as const }, include: { jobs: { include: { connectedSocialAccount: { select: { displayName: true, username: true } } } } } },
} satisfies Prisma.ClipLibraryItemInclude;
export function libraryItemView(item: Prisma.ClipLibraryItemGetPayload<{ include: typeof itemInclude }>) {
  const posts = item.publishGroups.flatMap(group => group.jobs.map(job => ({ id: job.id, groupId: group.id, platform: job.platform, status: job.status,
    accountId: job.connectedSocialAccountId, account: job.connectedSocialAccount.username ?? job.connectedSocialAccount.displayName ?? job.platform,
    url: job.platformPostUrl, scheduledFor: job.scheduledFor?.toISOString() ?? group.scheduledFor?.toISOString() ?? null,
    error: job.errorMessage ? "Posting needs attention. Open the post to review or retry." : null })));
  const assets = item.assets.map(asset => ({ id: asset.id, platform: asset.platform, captions: asset.includeCaptions, status: asset.status,
    width: asset.width, height: asset.height, duration: asset.durationSeconds, bytes: asset.fileSizeBytes?.toString() ?? "0", savedAt: asset.savedAt?.toISOString() ?? null,
    thumbnailUrl: asset.thumbnailPath && !item.deletedAt ? `/api/library/${item.id}/assets/${asset.id}?kind=thumbnail` : null,
    videoUrl: asset.status === "ready" && !item.deletedAt ? `/api/library/${item.id}/assets/${asset.id}` : null,
    downloadUrl: asset.status === "ready" && !item.deletedAt ? `/api/library/${item.id}/assets/${asset.id}?download=1` : null }));
  return { id: item.id, title: item.title, postingCaption: item.postingCaption ?? "", sourceTitle: item.sourceTitle, sourceUrl: item.sourceUrl,
    sourcePlatform: item.sourcePlatform, duration: item.durationSeconds, createdAt: item.createdAt.toISOString(), deletedAt: item.deletedAt?.toISOString() ?? null,
    sourceAvailable: Boolean(item.sourceSession && item.sourceSession.liveStatus !== "replaced"), sourceSessionId: item.sourceSessionId,
    status: libraryStatus(posts, assets.some(asset => asset.status === "ready")), assets, posts,
    publishUrl: item.sourceClipId && !item.deletedAt ? `/clips/${item.sourceClipId}/publish?library=1` : null };
}
export async function listLibrary(request: Request) {
  const { accountId, userId } = await libraryAccount(request);
  const params = new URL(request.url).searchParams;
  const query = (params.get("q") ?? "").trim().slice(0, 200);
  const page = Math.min(10000, Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1));
  const trash = params.get("trash") === "1";
  const platform = (params.get("platform") ?? "").slice(0, 40);
  const destination = (params.get("account") ?? "").slice(0, 160);
  const where: Prisma.ClipLibraryItemWhereInput = { billingAccountId: accountId, purgedAt: null, deletedAt: trash ? { not: null } : null,
    AND: trash ? [] : [libraryStatusWhere(params.get("status") ?? ""), ...([7, 30, 90].includes(Number(params.get("days"))) ? [{ createdAt: { gte: new Date(Date.now() - Number(params.get("days")) * 86400000) } }] : []), ...(query ? [{ OR: [{ title: { contains: query, mode: "insensitive" as const } }, { sourceTitle: { contains: query, mode: "insensitive" as const } }] }] : []),
      ...(platform ? [{ OR: [{ assets: { some: { platform: { startsWith: platform } } } }, { publishGroups: { some: { jobs: { some: { platform } } } } }] }] : []),
      ...(destination ? [{ publishGroups: { some: { jobs: { some: { connectedSocialAccountId: destination } } } } }] : [])] };
  const [items, count, stored, trashBytes, trashCount, accounts] = await Promise.all([
    prisma.clipLibraryItem.findMany({ where, include: itemInclude, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * 24, take: 24 }),
    prisma.clipLibraryItem.count({ where }),
    prisma.clipLibraryAsset.aggregate({ where: { status: "ready", item: { billingAccountId: accountId, purgedAt: null } }, _sum: { fileSizeBytes: true } }),
    prisma.clipLibraryAsset.aggregate({ where: { status: "ready", item: { billingAccountId: accountId, deletedAt: { not: null }, purgedAt: null } }, _sum: { fileSizeBytes: true } }),
    prisma.clipLibraryItem.count({ where: { billingAccountId: accountId, deletedAt: { not: null }, purgedAt: null } }),
    prisma.connectedSocialAccount.findMany({ where: { userId }, select: { id: true, platform: true, displayName: true, username: true }, orderBy: { platform: "asc" } }),
  ]);
  return { items: items.map(libraryItemView), total: count, page, hasMore: page * 24 < count, trashCount,
    storageBytes: (stored._sum.fileSizeBytes ?? BigInt(0)).toString(), trashBytes: (trashBytes._sum.fileSizeBytes ?? BigInt(0)).toString(), accounts };
}
export async function getLibraryItem(request: Request, id: string) {
  const { accountId } = await libraryAccount(request);
  const item = await prisma.clipLibraryItem.findFirst({ where: { id, billingAccountId: accountId, deletedAt: null, purgedAt: null }, include: itemInclude });
  if (!item) throw new SessionAccessError("Saved clip not found", 404);
  return libraryItemView(item);
}
export async function trashLibraryItem(request: Request, id: string, restore = false) {
  const { accountId } = await ownedLibraryItem(request, id, true);
  const busy = await prisma.socialPublishJob.count({ where: { publishGroup: { libraryItemId: id }, status: { in: LIVE_POST_STATUSES } } });
  if (busy && !restore) throw new SessionAccessError("Cancel scheduled posts or wait for publishing to finish before moving this clip to Trash.", 409);
  const changed = await prisma.clipLibraryItem.updateMany({ where: { id, billingAccountId: accountId, purgedAt: null,
    OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date() } }] }, data: { deletedAt: restore ? null : new Date() } });
  if (!changed.count) throw new SessionAccessError("This clip is still being saved. Try again shortly.", 409);
}
