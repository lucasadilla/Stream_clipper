import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { emptySocialContent, type SocialGeneratedContent, type SocialPlatform, type SocialPublishSettings } from "@/lib/social/types";
import { EDITABLE_PUBLISH_STATUSES, assertTikTokPostConsent, safePublishError, socialGroupStatus } from "@/lib/social/publishingPolicy";
import { forcesPrivateUploads } from "@/lib/social/capabilities";
import { reviewSelectionSchema, futureSchedule, type PublishingPost } from "@/lib/social/workspace";
import { inspectPublishMedia } from "./socialPublishingService";
import { validateSocialPost } from "./socialPublishValidationService";
import { getPublisherContext } from "./socialConnectionService";
import { getSocialPublisher } from "./publishers";
import { getPublishingPreferences } from "./socialPublishingPreferenceService";
import { setPublishingPaused } from "./publishingControlService";

const jobInclude = {
  publishGroup: { select: { id: true, clipSuggestionId: true } },
  connectedSocialAccount: { select: { id: true, displayName: true, username: true, isActive: true } },
} satisfies Prisma.SocialPublishJobInclude;
type Job = Prisma.SocialPublishJobGetPayload<{ include: typeof jobInclude }>;

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export async function listPublishingPosts(userId: string, options: {
  view: "inbox" | "calendar" | "performance"; start?: Date; end?: Date; cursor?: string; accountId?: string;
}) {
  const where: Prisma.SocialPublishJobWhereInput = { publishGroup: { userId }, ...(options.accountId ? { connectedSocialAccountId: options.accountId } : {}) };
  if (options.view === "inbox") where.status = { in: ["draft", "awaiting_consent", "failed", "outcome_unknown", "awaiting_user"] };
  if (options.view === "calendar") {
    where.OR = [
      { status: { in: ["scheduled", "queued"] }, scheduledFor: { gte: options.start, lt: options.end } },
      { status: "completed", completedAt: { gte: options.start, lt: options.end } },
      { status: "queued", scheduledFor: null, createdAt: { gte: options.start, lt: options.end } },
    ];
  }
  if (options.view === "performance") where.status = "completed";
  const limit = options.view === "calendar" ? 1000 : 30;
  // Cursor IDs alone cannot expose another user's jobs: all queries retain ownership.
  if (options.cursor) {
    const cursor = await prisma.socialPublishJob.findFirst({ where: { id: options.cursor, publishGroup: { userId } }, select: { createdAt: true, id: true } });
    if (!cursor) throw new Error("Invalid page cursor");
    where.AND = [{ OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] }];
  }
  const rows = await prisma.socialPublishJob.findMany({ where, include: jobInclude, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit + 1 });
  const jobs = rows.slice(0, limit);
  const clips = await prisma.clipSuggestion.findMany({ where: { id: { in: [...new Set(jobs.map((j) => j.publishGroup.clipSuggestionId))] } }, select: { id: true, title: true } });
  const titles = new Map(clips.map((clip) => [clip.id, clip.title]));
  const posts: PublishingPost[] = jobs.map((job: Job) => {
    const copy = object(job.editedContent ?? job.generatedContent);
    return { id: job.id, groupId: job.publishGroupId, clipId: job.publishGroup.clipSuggestionId,
      clipTitle: titles.get(job.publishGroup.clipSuggestionId) || "Clip", platform: job.platform, status: job.status,
      version: job.updatedAt.toISOString(), accountId: job.connectedSocialAccountId,
      accountName: job.connectedSocialAccount.username || job.connectedSocialAccount.displayName || job.platform,
      title: typeof copy.title === "string" ? copy.title : "", caption: String(copy.caption || copy.description || copy.postText || ""),
      settings: object(job.publishSettings), scheduledFor: job.scheduledFor?.toISOString() || null,
      completedAt: job.completedAt?.toISOString() || null, createdAt: job.createdAt.toISOString(), previewUrl: job.videoPath ? `/api/social/publish-jobs/${job.id}/preview` : null,
      postUrl: job.platformPostUrl, error: job.errorMessage,
      content: { ...emptySocialContent(job.platform as SocialPlatform), ...copy, platform: job.platform } as SocialGeneratedContent };
  });
  return { posts, nextCursor: rows.length > limit ? jobs.at(-1)?.id || null : null };
}

async function refreshGroups(ids: string[]) {
  for (const id of new Set(ids)) {
    const jobs = await prisma.socialPublishJob.findMany({ where: { publishGroupId: id }, select: { status: true, scheduledFor: true } });
    const dates = jobs.filter((job) => job.status === "scheduled" && job.scheduledFor).map((job) => job.scheduledFor!);
    await prisma.socialPublishGroup.update({ where: { id }, data: { status: socialGroupStatus(jobs.map((j) => j.status)), scheduledFor: dates.length ? new Date(Math.min(...dates.map(Number))) : null } });
  }
}

/** Every selected destination has its own compare-and-swap; never approves siblings. */
export async function approvePublishingPosts(userId: string, input: unknown) {
  const selection = reviewSelectionSchema.parse(input);
  const scheduledFor = futureSchedule(selection.scheduledFor);
  if ((await getPublishingPreferences(userId)).publishingPaused) throw new Error("Publishing is paused. Resume it before approving posts.");
  const results: Array<{ id: string; ok: boolean; error?: string }> = [];
  const changedGroups: string[] = [];
  for (const selected of selection.jobs) {
    try {
      const job = await prisma.socialPublishJob.findFirst({ where: { id: selected.id, publishGroup: { userId } }, include: jobInclude });
      if (!job) throw new Error("Post not found");
      if (!EDITABLE_PUBLISH_STATUSES.includes(job.status) || job.lockedBy || job.updatedAt.toISOString() !== selected.version) throw new Error("This post changed. Reload and review it again.");
      if (!job.connectedSocialAccount.isActive) throw new Error("Reconnect this account before posting.");
      if (!job.videoPath) throw new Error("Prepare the finished export before approving this post.");
      const platform = job.platform as SocialPlatform;
      const settings = { ...object(job.publishSettings) } as SocialPublishSettings;
      if (forcesPrivateUploads(platform)) settings.privacy = "private";
      if (platform === "tiktok") {
        if (!selected.tiktokConsent) throw new Error("Review this TikTok video and give its individual posting consent.");
        settings.postConsent = true;
        assertTikTokPostConsent(settings);
      }
      const content = { ...emptySocialContent(platform), ...object(job.editedContent ?? job.generatedContent), platform } as SocialGeneratedContent;
      const media = await inspectPublishMedia(job.videoPath, job.platformExportId);
      const validation = validateSocialPost({ platform, content, settings, media });
      if (!validation.ok) throw new Error(validation.warnings.find((warning) => warning.severity === "error")?.message || "Fix this post's validation errors.");
      const ctx = { ...await getPublisherContext(job.connectedSocialAccountId), destinationId: job.destinationId };
      const remote = await getSocialPublisher(platform).validatePost(ctx, { media, content, settings, idempotencyKey: job.idempotencyKey });
      if (!remote.ok) throw new Error(remote.warnings.find((warning) => warning.severity === "error")?.message || "This destination isn't ready.");
      if (scheduledFor) futureSchedule(scheduledFor.toISOString());
      await prisma.$transaction(async (tx) => {
        const changed = await tx.socialPublishJob.updateMany({ where: { id: job.id, publishGroup: { userId }, status: { in: EDITABLE_PUBLISH_STATUSES }, updatedAt: job.updatedAt, lockedBy: null },
          data: { status: scheduledFor ? "scheduled" : "queued", scheduledFor, publishSettings: settings as Prisma.InputJsonValue, errorCode: null, errorMessage: null, validationWarnings: [...validation.warnings, ...remote.warnings] as unknown as Prisma.InputJsonValue } });
        if (changed.count !== 1) throw new Error("This post changed. Reload and review it again.");
        await tx.socialPublishEvent.create({ data: { publishJobId: job.id, type: scheduledFor ? "scheduled" : "queued", message: scheduledFor ? "Scheduled after batch review" : "Approved in the review inbox" } });
      });
      changedGroups.push(job.publishGroupId); results.push({ id: job.id, ok: true });
    } catch (error) { results.push({ id: selected.id, ok: false, error: safePublishError(error instanceof Error ? error.message : "Could not approve post") }); }
  }
  await refreshGroups(changedGroups);
  return { results };
}

export async function changePublishingPost(userId: string, id: string, input: { action: "reschedule" | "hold" | "cancel"; version: string; scheduledFor?: string }) {
  const scheduledFor = input.action === "reschedule" ? futureSchedule(input.scheduledFor) : null;
  if (input.action === "reschedule" && !scheduledFor) throw new Error("Choose a future posting time.");
  const job = await prisma.socialPublishJob.findFirst({ where: { id, publishGroup: { userId } } });
  if (!job) throw new Error("Post not found");
  if (!["queued", "scheduled", "draft", "awaiting_consent"].includes(job.status) || job.lockedBy || job.platformPostId) throw new Error("This post has already started. It cannot be changed here.");
  if (input.action === "reschedule" && !["queued", "scheduled"].includes(job.status)) throw new Error("Approve this draft before scheduling it.");
  const settings = object(job.publishSettings);
  const status = input.action === "reschedule" ? "scheduled" : input.action === "hold" ? "draft" : "cancelled";
  await prisma.$transaction(async (tx) => {
    const changed = await tx.socialPublishJob.updateMany({ where: { id, publishGroup: { userId }, updatedAt: new Date(input.version), status: job.status, lockedBy: null },
      data: { status, scheduledFor, ...(input.action === "hold" ? { publishSettings: { ...settings, postConsent: false } as Prisma.InputJsonValue } : {}) } });
    if (changed.count !== 1) throw new Error("This post changed. Reload the calendar.");
    await tx.socialPublishEvent.create({ data: { publishJobId: id, type: status, message: input.action === "hold" ? "Returned to the review inbox" : input.action === "cancel" ? "Cancelled in the publishing calendar" : "Posting time changed in the calendar" } });
  });
  await refreshGroups([job.publishGroupId]);
}

export async function pausePublishing(userId: string, paused: boolean) {
  await setPublishingPaused(userId, paused);
  if (paused) await prisma.streamAutomation.updateMany({ where: { userId }, data: { enabled: false, autoPublishEnabled: false } });
  return { paused };
}
