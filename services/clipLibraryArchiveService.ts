import { randomUUID } from "crypto";
import fs from "fs/promises";
import { prisma } from "@/lib/db";
import { extractSoloTimelineFrame, probeMedia } from "@/lib/ffmpeg";
import { resolveStoragePath } from "@/lib/storage";
import { libraryAssetPath, preserveLibraryFile, removeLibraryFiles, toRelativeStoragePath } from "@/lib/clipLibraryStorage";
import { LIBRARY_TRASH_DAYS, LIVE_POST_STATUSES } from "@/lib/clipLibrary";

interface Capture {
  kind: "render" | "platform";
  originId: string;
  sessionId: string;
  clipId: string;
  accountId: string;
  userId: string | null;
  title: string;
  sourceTitle: string | null;
  sourceUrl: string;
  sourcePlatform: string;
  duration: number;
  createdAt: Date;
  platform: string;
  captions: boolean;
  output: string | null;
  thumbnail?: string | null;
}

async function markOrigin(input: Capture, libraryState: string, outputPath?: string, thumbnailPath?: string | null) {
  if (input.kind === "render") await prisma.renderJob.update({ where: { id: input.originId }, data: { libraryState, ...(outputPath ? { outputPath } : {}) } });
  else await prisma.platformExport.update({ where: { id: input.originId }, data: { libraryState, ...(outputPath ? { outputPath, thumbnailPath } : {}) } });
}

async function capture(input: Capture): Promise<void> {
  const item = await prisma.clipLibraryItem.upsert({ where: { id: input.clipId }, create: {
    id: input.clipId, billingAccountId: input.accountId, sourceClipId: input.clipId, sourceSessionId: input.sessionId,
    title: input.title, sourceTitle: input.sourceTitle, sourceUrl: input.sourceUrl, sourcePlatform: input.sourcePlatform,
    durationSeconds: input.duration, createdAt: input.createdAt,
  }, update: {} });
  if (item.billingAccountId !== input.accountId) throw new Error("Library owner mismatch");
  if (item.deletedAt || item.purgedAt) { await markOrigin(input, "ignored"); return; }
  const lease = randomUUID();
  const claimed = await prisma.clipLibraryItem.updateMany({ where: { id: item.id, deletedAt: null, purgedAt: null,
    OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date() } }] }, data: { lockedBy: lease, lockedUntil: new Date(Date.now() + 300_000) } });
  if (!claimed.count) throw new Error("This clip is still being saved. Cleanup will retry.");
  const assetId = `${input.kind === "render" ? "r" : "p"}_${input.originId}`;
  try {
    const asset = await prisma.clipLibraryAsset.upsert({ where: { id: assetId }, create: {
      id: assetId, itemId: item.id, originKind: input.kind, originId: input.originId, platform: input.platform, includeCaptions: input.captions,
    }, update: {} });
    const source = input.output ? resolveStoragePath(input.output) : null;
    const sourceStat = source ? await fs.stat(source).catch(error => { if (error.code === "ENOENT") return null; throw error; }) : null;
    if (asset.status === "ready" && asset.outputPath === input.output && sourceStat?.isFile() && sourceStat.size === Number(asset.fileSizeBytes)) return;
    if (!sourceStat?.isFile() || !sourceStat.size) {
      await prisma.clipLibraryAsset.update({ where: { id: asset.id }, data: { status: "missing", outputPath: null } });
      await markOrigin(input, "missing");
      return;
    }
    const destination = libraryAssetPath(input.accountId, item.id, assetId);
    const bytes = await preserveLibraryFile(source!, destination);
    const outputPath = toRelativeStoragePath(destination);
    const dimensions = await probeMedia(destination);
    if (!dimensions.videoCodec || dimensions.durationSeconds <= 0) throw new Error("Saved video could not be verified");
    const cover = libraryAssetPath(input.accountId, item.id, assetId, "jpg");
    let thumbnailPath: string | null = null;
    try {
      if (input.thumbnail) await preserveLibraryFile(resolveStoragePath(input.thumbnail), cover);
      else await extractSoloTimelineFrame(destination, cover, Math.min(5, dimensions.durationSeconds / 3), 480, 2);
      if ((await fs.stat(cover)).size > 0) thumbnailPath = toRelativeStoragePath(cover);
    } catch { /* A thumbnail failure must never discard a finished video. */ }
    await prisma.$transaction(async tx => {
      const stillOwned = await tx.clipLibraryItem.updateMany({ where: { id: item.id, lockedBy: lease, deletedAt: null, purgedAt: null }, data: { updatedAt: new Date() } });
      if (!stillOwned.count) throw new Error("Library save ownership changed; retrying");
      await tx.clipLibraryAsset.update({ where: { id: asset.id }, data: { status: "ready", outputPath, thumbnailPath,
        fileSizeBytes: BigInt(bytes), width: dimensions.width, height: dimensions.height, durationSeconds: dimensions.durationSeconds, savedAt: asset.savedAt ?? new Date() } });
      if (input.kind === "render") await tx.renderJob.update({ where: { id: input.originId }, data: { outputPath, libraryState: "saved" } });
      else await tx.platformExport.update({ where: { id: input.originId }, data: { outputPath, thumbnailPath, libraryState: "saved" } });
      if (input.userId) {
        await tx.socialPublishGroup.updateMany({ where: { clipSuggestionId: item.id, userId: input.userId }, data: { libraryItemId: item.id } });
        await tx.socialPublishJob.updateMany({ where: { videoPath: { in: [input.output!, source!] }, publishGroup: { userId: input.userId, clipSuggestionId: item.id } }, data: { videoPath: destination } });
      }
    });
  } finally {
    await prisma.clipLibraryItem.updateMany({ where: { id: item.id, lockedBy: lease }, data: { lockedBy: null, lockedUntil: null } });
  }
}

export async function archiveCompletedRender(id: string): Promise<void> {
  const job = await prisma.renderJob.findUnique({ where: { id }, include: { clipSuggestion: true, streamSession: { include: { billingAccount: true } } } });
  if (!job || job.status !== "completed") return;
  const params = job.params && typeof job.params === "object" && !Array.isArray(job.params) ? job.params as Record<string, unknown> : {};
  const session = job.streamSession;
  if (params.preview === true || !session.billingAccountId) {
    await prisma.renderJob.update({ where: { id }, data: { libraryState: "ignored" } }); return;
  }
  // Manual timeline cuts get a stable clip identity too, so they can be published later.
  const start = typeof params.startTimeSeconds === "number" ? params.startTimeSeconds : 0;
  const end = typeof params.endTimeSeconds === "number" ? params.endTimeSeconds : start;
  const clip = job.clipSuggestion ?? await prisma.clipSuggestion.upsert({ where: { id: `saved_${id}` }, create: {
    id: `saved_${id}`, streamSessionId: session.id, title: session.title ? `${session.title} — clip` : "Saved clip",
    reason: "", startTimeSeconds: start, endTimeSeconds: end, status: "rendered",
    suggestedFormat: params.format === "native" ? "16:9" : "9:16",
  }, update: {} });
  if (!job.clipSuggestionId) await prisma.renderJob.update({ where: { id }, data: { clipSuggestionId: clip.id } });
  await capture({ kind: "render", originId: id, sessionId: session.id, clipId: clip.id, accountId: session.billingAccountId,
    userId: session.billingAccount?.userId ?? null, title: clip.title, sourceTitle: session.title, sourceUrl: session.youtubeUrl,
    sourcePlatform: session.platform, duration: Math.max(0, clip.endTimeSeconds - clip.startTimeSeconds), createdAt: clip.createdAt,
    platform: typeof params.platformTarget === "string" ? params.platformTarget : "general", captions: job.includeCaptions, output: job.outputPath });
}

export async function archiveCompletedPlatformExport(id: string): Promise<void> {
  const row = await prisma.platformExport.findUnique({ where: { id }, include: { clipSuggestion: true, renderJob: { select: { includeCaptions: true } }, streamSession: { include: { billingAccount: true } } } });
  if (!row || row.status !== "completed") return;
  if (!row.streamSession.billingAccountId) { await prisma.platformExport.update({ where: { id }, data: { libraryState: "ignored" } }); return; }
  const settings = row.exportSettings && typeof row.exportSettings === "object" ? row.exportSettings as Record<string, unknown> : {};
  await capture({ kind: "platform", originId: id, sessionId: row.streamSessionId, clipId: row.clipSuggestionId,
    accountId: row.streamSession.billingAccountId, userId: row.streamSession.billingAccount?.userId ?? null,
    title: row.clipSuggestion.title, sourceTitle: row.streamSession.title, sourceUrl: row.streamSession.youtubeUrl,
    sourcePlatform: row.streamSession.platform, duration: row.durationSeconds ?? row.clipSuggestion.endTimeSeconds - row.clipSuggestion.startTimeSeconds,
    createdAt: row.clipSuggestion.createdAt, platform: row.platform, captions: row.renderJob?.includeCaptions === true || settings.burnSubtitles === true,
    output: row.outputPath, thumbnail: row.thumbnailPath });
}

/** Fail closed: raw workspace cleanup must not race an active encode or an incomplete library copy. */
export async function preserveSessionDeliverables(sessionId: string): Promise<void> {
  const [renders, exports, busyRenders, busyExports] = await Promise.all([
    prisma.renderJob.findMany({ where: { streamSessionId: sessionId, status: "completed" }, select: { id: true } }),
    prisma.platformExport.findMany({ where: { streamSessionId: sessionId, status: "completed" }, select: { id: true } }),
    prisma.renderJob.count({ where: { streamSessionId: sessionId, status: { in: ["queued", "processing"] } } }),
    prisma.platformExport.count({ where: { streamSessionId: sessionId, status: { in: ["queued", "processing"] } } }),
  ]);
  if (busyRenders || busyExports) throw new Error("Workspace cleanup deferred until its exports finish.");
  for (const job of renders) await archiveCompletedRender(job.id);
  for (const job of exports) await archiveCompletedPlatformExport(job.id);
}

export async function purgeLibraryItem(itemId: string, accountId: string): Promise<void> {
  const lease = randomUUID();
  const claimed = await prisma.clipLibraryItem.updateMany({ where: { id: itemId, billingAccountId: accountId, deletedAt: { not: null }, purgedAt: null,
    OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date() } }] }, data: { lockedBy: lease, lockedUntil: new Date(Date.now() + 300_000) } });
  if (!claimed.count) throw new Error("Clip is being saved or is not in Trash.");
  try {
    const busy = await prisma.socialPublishJob.count({ where: { publishGroup: { libraryItemId: itemId }, status: { in: LIVE_POST_STATUSES } } });
    if (busy) throw new Error("Cancel active or scheduled posts before deleting the saved video.");
    await removeLibraryFiles(accountId, itemId);
    await prisma.$transaction([
      prisma.clipLibraryAsset.updateMany({ where: { itemId }, data: { status: "missing", outputPath: null, thumbnailPath: null, fileSizeBytes: null } }),
      prisma.clipLibraryItem.update({ where: { id: itemId, lockedBy: lease }, data: { purgedAt: new Date() } }),
    ]);
  } finally { await prisma.clipLibraryItem.updateMany({ where: { id: itemId, lockedBy: lease }, data: { lockedBy: null, lockedUntil: null } }); }
}

export async function runLibraryMaintenance(): Promise<boolean> {
  const [renders, exports, trash] = await Promise.all([
    prisma.renderJob.findMany({ where: { status: "completed", libraryState: "pending" }, take: 5, orderBy: [{ updatedAt: "asc" }, { id: "asc" }], select: { id: true } }),
    prisma.platformExport.findMany({ where: { status: "completed", libraryState: "pending" }, take: 5, orderBy: [{ updatedAt: "asc" }, { id: "asc" }], select: { id: true } }),
    prisma.clipLibraryItem.findMany({ where: { deletedAt: { lt: new Date(Date.now() - LIBRARY_TRASH_DAYS * 86_400_000) }, purgedAt: null }, take: 5, select: { id: true, billingAccountId: true } }),
  ]);
  let succeeded = 0;
  // Rotate failed copies behind other pending work so one damaged legacy file cannot starve the queue.
  for (const row of renders) try { await archiveCompletedRender(row.id); succeeded++; } catch {
    await prisma.renderJob.updateMany({ where: { id: row.id, libraryState: "pending" }, data: { updatedAt: new Date() } }).catch(() => undefined);
    console.warn("[library] Saving a finished render will retry; workspace files retained.");
  }
  for (const row of exports) try { await archiveCompletedPlatformExport(row.id); succeeded++; } catch {
    await prisma.platformExport.updateMany({ where: { id: row.id, libraryState: "pending" }, data: { updatedAt: new Date() } }).catch(() => undefined);
    console.warn("[library] Saving a platform export will retry; workspace files retained.");
  }
  for (const row of trash) try { await purgeLibraryItem(row.id, row.billingAccountId); } catch { /* In-flight work or a filesystem lock will be retried. */ }
  return succeeded > 0 && (renders.length === 5 || exports.length === 5);
}
let started = false;
export function startClipLibraryPoller() {
  if (started) return;
  started = true;
  const tick = async () => {
    let more = false;
    try { more = await runLibraryMaintenance(); } catch { console.warn("[library] Maintenance deferred."); }
    setTimeout(() => void tick(), more ? 1000 : 60_000).unref();
  };
  setTimeout(() => void tick(), 20_000).unref();
}
