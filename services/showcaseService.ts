import { createHash, randomUUID } from "crypto";
import path from "path";
import { copyFile, mkdir, readdir, stat, unlink } from "fs/promises";
import { prisma } from "@/lib/db";
import { extractFastTimelineFrame, probeMedia } from "@/lib/ffmpeg";
import { getStorageRoot, getUploadDir, resolveStoragePath, toRelativeStoragePath } from "@/lib/storage";
import { showcaseIsPublic, selectShowcaseMix, type PublicShowcaseClip } from "@/lib/publicLanding";
import { SessionAccessError } from "@/services/social/socialAccessService";

export function isShowcaseAdmin(userId: string): boolean {
  return (process.env.SHOWCASE_ADMIN_USER_IDS || "").split(",").map(id => id.trim()).filter(Boolean).includes(userId);
}
export async function requireShowcaseAdmin(userId: string) {
  if (!isShowcaseAdmin(userId)) throw new SessionAccessError("Showcase review is restricted to configured owners.", 403);
}

export async function getPublicShowcase(options: { strict?: boolean } = {}): Promise<PublicShowcaseClip[]> {
  try {
    const rows = await prisma.showcaseClip.findMany({ where: { status: "approved", consentAt: { not: null }, approvedAt: { not: null } }, orderBy: { approvedAt: "desc" }, take: 12 });
    const jobs = await prisma.socialPublishJob.findMany({ where: { platformExportId: { in: rows.map(row => row.platformExportId) }, status: "completed", platformPostId: { not: null } }, select: { platformExportId: true, platform: true, platformPostId: true } });
    const metrics = jobs.length ? await prisma.publicPostMetric.findMany({ where: { OR: jobs.map(job => ({ platform: job.platform, platformPostId: job.platformPostId! })) }, select: { platform: true, platformPostId: true, views: true } }) : [];
    const views = (exportId: string) => {
      const keys = new Set(jobs.filter(job => job.platformExportId === exportId).map(job => `${job.platform}:${job.platformPostId}`));
      const counts = metrics.filter(metric => keys.has(`${metric.platform}:${metric.platformPostId}`) && metric.views !== null);
      return counts.length ? counts.reduce((sum, metric) => sum + metric.views!, BigInt(0)).toString() : null;
    };
    return selectShowcaseMix(rows.map(row => ({ id: row.id, sourceGroup: row.sourceGroup, sourceTitle: row.sourceTitle, title: row.title, creatorName: row.creatorName, category: row.category, views: views(row.platformExportId),
      platform: row.platform, durationSeconds: row.durationSeconds, videoUrl: `/api/public/showcase/${row.id}/video`, posterUrl: `/api/public/showcase/${row.id}/poster`,
      sourceVideoUrl: row.sourceVideoPath ? `/api/public/showcase/${row.id}/source` : null,
      sourcePosterUrl: row.sourcePosterPath ? `/api/public/showcase/${row.id}/source-poster` : null })));
  } catch (error) { if (options.strict) throw error; return []; }
}

/** Copies only an owned completed export. No arbitrary URLs/paths or new AI/render jobs. */
export async function submitShowcase(userId: string, input: { exportId: string; creatorName: string; title: string; category: string; consent: true }) {
  const item = await prisma.platformExport.findFirst({ where: { id: input.exportId, status: "completed", streamSession: { billingAccount: { userId } } },
    include: { clipSuggestion: true, streamSession: { select: { title: true } } } });
  if (!item?.outputPath) throw new SessionAccessError("Finished export not found in your account.", 404);
  const existing = await prisma.showcaseClip.findUnique({ where: { platformExportId: item.id } });
  if (existing) throw new Error("This export has already been submitted. Manage it below.");
  if (await prisma.showcaseClip.count({ where: { userId, status: { in: ["pending", "approved"] } } }) >= 12) throw new Error("You can submit up to 12 active showcase clips.");
  const video = resolveStoragePath(item.outputPath);
  const [file, media] = await Promise.all([stat(video), probeMedia(video)]);
  if (file.size > 200 * 1024 * 1024 || media.durationSeconds > 120.5 || media.durationSeconds < 1 || media.width >= media.height) throw new Error("Choose a finished vertical clip under two minutes and 200 MB.");
  const id = randomUUID(), dir = path.join(getStorageRoot(), "showcase", id);
  await mkdir(dir, { recursive: true });
  const made: string[] = [];
  const clipPath = path.join(dir, "clip.mp4"), poster = path.join(dir, "poster.jpg");
  let sourceVideoPath: string | null = null, sourcePosterPath: string | null = null;
  try {
    await copyFile(video, clipPath); made.push(clipPath);
    await extractFastTimelineFrame(clipPath, poster, Math.min(1, media.durationSeconds / 3), 540, 2); made.push(poster);
    // Reuse the already-made widescreen Studio excerpt if still cached. Never acquire a new source.
    const uploadDir = getUploadDir(item.streamSessionId);
    const cached = (await readdir(uploadDir).catch(() => [])).find(name => name === `studio-preview-av2-${item.clipSuggestionId}-${Math.round(item.clipSuggestion.startTimeSeconds * 1000)}-${Math.round(item.clipSuggestion.endTimeSeconds * 1000)}.mp4`);
    if (cached) {
      try {
        const original = path.join(uploadDir, cached), info = await probeMedia(original);
        if (info.width > info.height && info.durationSeconds <= 120.5 && (await stat(original)).size <= 100 * 1024 * 1024) {
          const wideVideo = path.join(dir, "source.mp4"), widePoster = path.join(dir, "source.jpg");
          await copyFile(original, wideVideo); made.push(wideVideo);
          await extractFastTimelineFrame(original, widePoster, Math.min(1, info.durationSeconds / 3), 1280, 2); made.push(widePoster);
          sourceVideoPath = toRelativeStoragePath(wideVideo); sourcePosterPath = toRelativeStoragePath(widePoster);
        }
      } catch { /* The finished short can be featured even after the source cache was removed. */ }
    }
    return await prisma.$transaction(async tx => {
      await tx.clipSuggestion.update({ where: { id: item.clipSuggestionId }, data: { marketingApproved: true, marketingApprovedAt: new Date() } });
      return tx.showcaseClip.create({ data: { id, userId, platformExportId: item.id, clipSuggestionId: item.clipSuggestionId,
        sourceGroup: createHash("sha256").update(`${userId}:${item.streamSessionId}`).digest("hex").slice(0, 24), sourceTitle: item.streamSession.title || "Original video",
        title: input.title, category: input.category, creatorName: input.creatorName, platform: item.platform, videoPath: toRelativeStoragePath(clipPath), posterPath: toRelativeStoragePath(poster),
        sourceVideoPath, sourcePosterPath, durationSeconds: media.durationSeconds, consentAt: new Date() } });
    });
  } catch (error) {
    await Promise.allSettled(made.map(filePath => unlink(filePath)));
    throw error;
  }
}

export async function manageShowcase(userId: string, id: string, action: "withdraw" | "resubmit" | "approve" | "reject") {
  if (action === "approve" || action === "reject") await requireShowcaseAdmin(userId);
  const where = { id, ...((action === "withdraw" || action === "resubmit") ? { userId } : {}) };
  const row = await prisma.showcaseClip.findFirst({ where });
  if (!row) throw new SessionAccessError("Showcase clip not found.", 404);
  if (action === "approve") {
    if (row.status !== "pending" || !row.consentAt) throw new Error("Only a pending, opted-in clip can be approved.");
    await stat(resolveStoragePath(row.videoPath));
    if (await prisma.showcaseClip.count({ where: { status: "approved" } }) >= 12) throw new Error("The showcase has 12 clips. Remove an existing featured clip before approving another.");
  }
  const changed = await prisma.showcaseClip.updateMany({ where: { ...where, updatedAt: row.updatedAt, status: row.status }, data:
    action === "withdraw" ? { status: "withdrawn", consentAt: null, approvedAt: null } :
    action === "resubmit" ? { status: "pending", consentAt: new Date(), approvedAt: null } :
    action === "approve" ? { status: "approved", approvedAt: new Date() } : { status: "rejected", approvedAt: null } });
  if (!changed.count) throw new Error("This submission changed. Reload and review it again.");
}

export async function getShowcaseMedia(id: string, kind: string, userId?: string) {
  const row = await prisma.showcaseClip.findUnique({ where: { id } });
  if (!row || (!showcaseIsPublic(row) && !(userId && (row.userId === userId || isShowcaseAdmin(userId))))) return null;
  return kind === "video" ? row.videoPath : kind === "poster" ? row.posterPath : kind === "source" ? row.sourceVideoPath : kind === "source-poster" ? row.sourcePosterPath : null;
}
