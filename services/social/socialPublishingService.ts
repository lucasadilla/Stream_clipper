import type { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { existsSync } from "fs";
import { prisma } from "@/lib/db";
import { canPublishPlatform, forcesPrivateUploads } from "@/lib/social/capabilities";
import type {
  PreparedMedia,
  SocialGeneratedContent,
  SocialPlatform,
  SocialPublishSettings,
  SocialValidationWarning,
} from "@/lib/social/types";
import { emptySocialContent, isSocialPlatform } from "@/lib/social/types";
import { resolveStoragePath } from "@/lib/storage";
import { generateSocialContent } from "@/services/social/socialContentGenerationService";
import { getPublisherContext } from "@/services/social/socialConnectionService";
import { getSocialPublisher } from "@/services/social/publishers";
import { validateSocialPost } from "@/services/social/socialPublishValidationService";
import { getPublishingPreferences } from "@/services/social/socialPublishingPreferenceService";

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function asContent(value: unknown, platform: SocialPlatform): SocialGeneratedContent {
  if (value && typeof value === "object") {
    return { ...emptySocialContent(platform), ...(value as SocialGeneratedContent), platform };
  }
  return emptySocialContent(platform);
}

function asSettings(value: unknown): SocialPublishSettings {
  if (value && typeof value === "object") return value as SocialPublishSettings;
  return {};
}

async function appendEvent(
  jobId: string,
  type: string,
  message: string,
  safeMetadata?: Record<string, unknown>
) {
  await prisma.socialPublishEvent.create({
    data: {
      publishJobId: jobId,
      type,
      message,
      safeMetadata: safeMetadata ? asJson(safeMetadata) : undefined,
    },
  });
}

async function loadClipContext(clipSuggestionId: string) {
  const clip = await prisma.clipSuggestion.findUnique({
    where: { id: clipSuggestionId },
    include: {
      streamSession: {
        select: {
          id: true,
          title: true,
          channelTitle: true,
          youtubeUrl: true,
          billingAccountId: true,
        },
      },
      renderJobs: {
        where: { status: "completed" },
        orderBy: { completedAt: "desc" },
        take: 5,
      },
      platformExports: {
        where: { status: "completed" },
        orderBy: { completedAt: "desc" },
      },
    },
  });
  if (!clip) throw new Error("Clip not found");
  return clip;
}

export async function resolvePublishMedia(options: {
  clipSuggestionId: string;
  platform: SocialPlatform;
  youtubeFormat?: "shorts" | "standard";
}): Promise<PreparedMedia> {
  const clip = await loadClipContext(options.clipSuggestionId);
  const preferredExportKey =
    options.platform === "youtube"
      ? options.youtubeFormat === "standard"
        ? "youtube_landscape"
        : "youtube_shorts"
      : options.platform === "tiktok"
        ? "tiktok"
        : options.platform === "instagram"
          ? "instagram_reels"
          : options.platform === "facebook"
            ? "facebook_reels"
            : options.platform === "x"
              ? "x"
              : null;

  const match = preferredExportKey
    ? clip.platformExports.find((item) => item.platform === preferredExportKey && item.outputPath)
    : null;

  if (match?.outputPath) {
    const filePath = resolveStoragePath(match.outputPath);
    return {
      filePath,
      mimeType: "video/mp4",
      fileSizeBytes: Number(match.fileSizeBytes ?? 0),
      width: match.width,
      height: match.height,
      durationSeconds: match.durationSeconds,
      platformExportId: match.id,
    };
  }

  const render = clip.renderJobs.find((job) => job.outputPath);
  if (!render?.outputPath) {
    throw new Error("No completed render found for this clip");
  }
  const filePath = resolveStoragePath(render.outputPath);
  if (!existsSync(filePath)) {
    throw new Error("Rendered clip file is missing on disk");
  }
  return {
    filePath,
    mimeType: "video/mp4",
    fileSizeBytes: 0,
    platformExportId: null,
  };
}

async function gatherTranscript(streamSessionId: string, start: number, end: number) {
  const chunks = await prisma.transcriptChunk.findMany({
    where: {
      streamSessionId,
      startTimeSeconds: { lte: end },
      endTimeSeconds: { gte: start },
    },
    orderBy: { startTimeSeconds: "asc" },
    take: 80,
    select: { text: true },
  });
  return chunks.map((c) => c.text).join(" ").trim();
}

export async function createPublishGroup(options: {
  userId: string;
  clipSuggestionId: string;
  destinations: Array<{
    connectedSocialAccountId: string;
    platform: SocialPlatform;
    destinationId?: string | null;
    settings?: SocialPublishSettings;
  }>;
}) {
  if (!options.destinations.length) {
    throw new Error("Select at least one destination");
  }

  const clip = await loadClipContext(options.clipSuggestionId);
  const transcript = await gatherTranscript(
    clip.streamSessionId,
    clip.startTimeSeconds,
    clip.endTimeSeconds
  );
  const prefs = await getPublishingPreferences(options.userId);

  const group = await prisma.socialPublishGroup.create({
    data: {
      userId: options.userId,
      clipSuggestionId: options.clipSuggestionId,
      status: "awaiting_review",
    },
  });

  const jobs = [];
  for (const dest of options.destinations) {
    if (!isSocialPlatform(dest.platform)) {
      throw new Error(`Unsupported platform: ${dest.platform}`);
    }
    if (!canPublishPlatform(dest.platform)) {
      throw new Error(`${dest.platform} publishing is not available`);
    }

    const account = await prisma.connectedSocialAccount.findFirst({
      where: {
        id: dest.connectedSocialAccountId,
        userId: options.userId,
        platform: dest.platform,
        isActive: true,
      },
    });
    if (!account) throw new Error("Connected account not found");

    const settings: SocialPublishSettings = {
      privacy: forcesPrivateUploads(dest.platform)
        ? "private"
        : dest.settings?.privacy || prefs.defaultPrivacy || "private",
      categoryId: dest.settings?.categoryId || "22",
      madeForKids: dest.settings?.madeForKids ?? false,
      notifySubscribers: dest.settings?.notifySubscribers ?? true,
      youtubeFormat:
        dest.settings?.youtubeFormat || prefs.youtubeFormat || "shorts",
      facebookFormat:
        dest.settings?.facebookFormat || prefs.facebookFormat || "reel",
      tiktokMode: dest.settings?.tiktokMode || prefs.tiktokMode || "direct",
      ...dest.settings,
    };

    const media = await resolvePublishMedia({
      clipSuggestionId: clip.id,
      platform: dest.platform,
      youtubeFormat: settings.youtubeFormat,
    });

    let content = await generateSocialContent({
      platform: dest.platform,
      clipTitle: clip.title,
      clipReason: clip.reason,
      transcriptText: transcript,
      streamTitle: clip.streamSession.title,
      streamerName: clip.streamSession.channelTitle,
      durationSeconds: clip.endTimeSeconds - clip.startTimeSeconds,
      sourceUrl: clip.streamSession.youtubeUrl,
      youtubeFormat: settings.youtubeFormat,
      tone: prefs.tone,
      emojiLevel: prefs.emojiLevel,
      hashtagLevel: prefs.hashtagLevel,
      includeSourceUrl: prefs.includeSourceUrl,
      useTranscriptQuotes: prefs.useTranscriptQuotes,
    });

    if (prefs.defaultHashtags.length) {
      const merged = Array.from(
        new Set([...prefs.defaultHashtags, ...content.hashtags])
      );
      content = { ...content, hashtags: merged };
    }

    const validation = validateSocialPost({
      platform: dest.platform,
      content,
      settings,
      media,
    });

    const job = await prisma.socialPublishJob.create({
      data: {
        publishGroupId: group.id,
        connectedSocialAccountId: account.id,
        platform: dest.platform,
        destinationId: dest.destinationId || account.platformAccountId,
        status: "draft",
        idempotencyKey: `pub_${group.id}_${account.id}_${randomUUID().slice(0, 8)}`,
        platformExportId: media.platformExportId,
        videoPath: media.filePath,
        generatedContent: asJson(content),
        editedContent: asJson(content),
        publishSettings: asJson(settings),
        validationWarnings: asJson(validation.warnings),
      },
    });
    await appendEvent(job.id, "created", "Draft publish job created");
    jobs.push(job);
  }

  return getPublishGroup(group.id, options.userId);
}

export async function getPublishGroup(groupId: string, userId: string) {
  const group = await prisma.socialPublishGroup.findFirst({
    where: { id: groupId, userId },
    include: {
      jobs: {
        include: {
          connectedSocialAccount: {
            select: {
              id: true,
              platform: true,
              displayName: true,
              username: true,
              avatarUrl: true,
            },
          },
          events: { orderBy: { createdAt: "desc" }, take: 20 },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!group) return null;
  return {
    id: group.id,
    clipSuggestionId: group.clipSuggestionId,
    status: group.status,
    scheduledFor: group.scheduledFor?.toISOString() ?? null,
    createdAt: group.createdAt.toISOString(),
    updatedAt: group.updatedAt.toISOString(),
    jobs: group.jobs.map((job) => ({
      id: job.id,
      platform: job.platform,
      status: job.status,
      destinationId: job.destinationId,
      attemptCount: job.attemptCount,
      validationWarnings: job.validationWarnings,
      generatedContent: job.generatedContent,
      editedContent: job.editedContent,
      publishSettings: job.publishSettings,
      platformPostId: job.platformPostId,
      platformPostUrl: job.platformPostUrl,
      errorCode: job.errorCode,
      errorMessage: job.errorMessage,
      scheduledFor: job.scheduledFor?.toISOString() ?? null,
      startedAt: job.startedAt?.toISOString() ?? null,
      completedAt: job.completedAt?.toISOString() ?? null,
      account: job.connectedSocialAccount,
      events: job.events.map((event) => ({
        id: event.id,
        type: event.type,
        message: event.message,
        createdAt: event.createdAt.toISOString(),
      })),
    })),
  };
}

export async function updatePublishJob(
  userId: string,
  jobId: string,
  patch: {
    editedContent?: SocialGeneratedContent;
    publishSettings?: SocialPublishSettings;
  }
) {
  const job = await prisma.socialPublishJob.findFirst({
    where: { id: jobId, publishGroup: { userId } },
  });
  if (!job) throw new Error("Publish job not found");
  if (["queued", "uploading", "processing", "publishing", "completed"].includes(job.status)) {
    throw new Error("Cannot edit a job that is already publishing or completed");
  }

  const content = patch.editedContent
    ? asContent(patch.editedContent, job.platform as SocialPlatform)
    : asContent(job.editedContent, job.platform as SocialPlatform);
  const settings = patch.publishSettings
    ? { ...asSettings(job.publishSettings), ...patch.publishSettings }
    : asSettings(job.publishSettings);

  if (forcesPrivateUploads(job.platform as SocialPlatform)) {
    settings.privacy = "private";
  }

  const media = job.videoPath
    ? {
        filePath: job.videoPath,
        mimeType: "video/mp4",
        fileSizeBytes: 0,
        platformExportId: job.platformExportId,
      }
    : null;

  const validation = validateSocialPost({
    platform: job.platform as SocialPlatform,
    content,
    settings,
    media,
  });

  await prisma.socialPublishJob.update({
    where: { id: jobId },
    data: {
      editedContent: asJson(content),
      publishSettings: asJson(settings),
      validationWarnings: asJson(validation.warnings),
    },
  });

  return getPublishGroup(job.publishGroupId, userId);
}

export async function regeneratePublishJobContent(userId: string, jobId: string) {
  const job = await prisma.socialPublishJob.findFirst({
    where: { id: jobId, publishGroup: { userId } },
    include: { publishGroup: true },
  });
  if (!job) throw new Error("Publish job not found");

  const clip = await loadClipContext(job.publishGroup.clipSuggestionId);
  const transcript = await gatherTranscript(
    clip.streamSessionId,
    clip.startTimeSeconds,
    clip.endTimeSeconds
  );
  const settings = asSettings(job.publishSettings);
  const content = await generateSocialContent({
    platform: job.platform as SocialPlatform,
    clipTitle: clip.title,
    clipReason: clip.reason,
    transcriptText: transcript,
    streamTitle: clip.streamSession.title,
    streamerName: clip.streamSession.channelTitle,
    durationSeconds: clip.endTimeSeconds - clip.startTimeSeconds,
    sourceUrl: clip.streamSession.youtubeUrl,
    youtubeFormat: settings.youtubeFormat,
  });

  return updatePublishJob(userId, jobId, { editedContent: content });
}

export async function validatePublishGroup(userId: string, groupId: string) {
  const group = await prisma.socialPublishGroup.findFirst({
    where: { id: groupId, userId },
    include: { jobs: true },
  });
  if (!group) throw new Error("Publish group not found");

  for (const job of group.jobs) {
    const media = job.videoPath
      ? {
          filePath: job.videoPath,
          mimeType: "video/mp4",
          fileSizeBytes: 0,
          platformExportId: job.platformExportId,
        }
      : null;
    const validation = validateSocialPost({
      platform: job.platform as SocialPlatform,
      content: asContent(job.editedContent, job.platform as SocialPlatform),
      settings: asSettings(job.publishSettings),
      media,
    });
    await prisma.socialPublishJob.update({
      where: { id: job.id },
      data: { validationWarnings: asJson(validation.warnings) },
    });
  }

  return getPublishGroup(groupId, userId);
}

export async function enqueuePublishGroup(options: {
  userId: string;
  groupId: string;
  mode: "now" | "schedule";
  scheduledFor?: Date | null;
}) {
  const group = await prisma.socialPublishGroup.findFirst({
    where: { id: options.groupId, userId: options.userId },
    include: { jobs: true },
  });
  if (!group) throw new Error("Publish group not found");

  const validated = await validatePublishGroup(options.userId, options.groupId);
  const blocking = (validated?.jobs || []).flatMap((job) => {
    const warnings = Array.isArray(job.validationWarnings)
      ? (job.validationWarnings as unknown as SocialValidationWarning[])
      : [];
    return warnings.filter((w) => w.severity === "error");
  });
  if (blocking.length > 0) {
    throw new Error("Fix validation errors before publishing");
  }

  if (options.mode === "schedule") {
    if (!options.scheduledFor || options.scheduledFor.getTime() <= Date.now()) {
      throw new Error("scheduledFor must be a future time");
    }
    await prisma.socialPublishGroup.update({
      where: { id: group.id },
      data: { status: "scheduled", scheduledFor: options.scheduledFor },
    });
    await prisma.socialPublishJob.updateMany({
      where: {
        publishGroupId: group.id,
        status: { in: ["draft", "awaiting_consent", "failed"] },
      },
      data: {
        status: "scheduled",
        scheduledFor: options.scheduledFor,
        errorCode: null,
        errorMessage: null,
      },
    });
  } else {
    await prisma.socialPublishGroup.update({
      where: { id: group.id },
      data: { status: "publishing", scheduledFor: null },
    });
    await prisma.socialPublishJob.updateMany({
      where: {
        publishGroupId: group.id,
        status: { in: ["draft", "awaiting_consent", "scheduled", "failed"] },
      },
      data: {
        status: "queued",
        scheduledFor: null,
        errorCode: null,
        errorMessage: null,
      },
    });
  }

  for (const job of group.jobs) {
    await appendEvent(
      job.id,
      options.mode === "schedule" ? "scheduled" : "queued",
      options.mode === "schedule"
        ? "Job scheduled in Clipper"
        : "Job queued for publishing"
    );
  }

  return getPublishGroup(group.id, options.userId);
}

export async function cancelPublishGroup(userId: string, groupId: string) {
  const group = await prisma.socialPublishGroup.findFirst({
    where: { id: groupId, userId },
    include: { jobs: true },
  });
  if (!group) throw new Error("Publish group not found");

  await prisma.socialPublishJob.updateMany({
    where: {
      publishGroupId: groupId,
      status: { in: ["draft", "queued", "scheduled", "awaiting_consent"] },
    },
    data: { status: "cancelled", scheduledFor: null },
  });
  await prisma.socialPublishGroup.update({
    where: { id: groupId },
    data: { status: "cancelled", scheduledFor: null },
  });
  for (const job of group.jobs) {
    if (
      ["draft", "queued", "scheduled", "awaiting_consent"].includes(job.status)
    ) {
      await appendEvent(job.id, "cancelled", "Publish job cancelled");
    }
  }
  return getPublishGroup(groupId, userId);
}

/** Cancel a Clipper schedule and return jobs to reviewable drafts. */
export async function unschedulePublishGroup(userId: string, groupId: string) {
  const group = await prisma.socialPublishGroup.findFirst({
    where: { id: groupId, userId },
    include: { jobs: true },
  });
  if (!group) throw new Error("Publish group not found");
  if (group.status !== "scheduled") {
    throw new Error("Only scheduled publishes can be unscheduled");
  }

  await prisma.socialPublishGroup.update({
    where: { id: groupId },
    data: { status: "awaiting_review", scheduledFor: null },
  });
  await prisma.socialPublishJob.updateMany({
    where: {
      publishGroupId: groupId,
      status: "scheduled",
    },
    data: { status: "draft", scheduledFor: null },
  });
  for (const job of group.jobs) {
    if (job.status === "scheduled") {
      await appendEvent(job.id, "unscheduled", "Schedule cancelled — back to review");
    }
  }
  return getPublishGroup(groupId, userId);
}

export async function listScheduledPublishGroups(userId: string) {
  const groups = await prisma.socialPublishGroup.findMany({
    where: {
      userId,
      status: "scheduled",
      scheduledFor: { not: null },
    },
    include: {
      jobs: {
        include: {
          connectedSocialAccount: {
            select: {
              id: true,
              platform: true,
              displayName: true,
              username: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { scheduledFor: "asc" },
    take: 50,
  });

  const clipIds = Array.from(
    new Set(groups.map((g) => g.clipSuggestionId))
  );
  const clips = clipIds.length
    ? await prisma.clipSuggestion.findMany({
        where: { id: { in: clipIds } },
        select: { id: true, title: true },
      })
    : [];
  const clipTitle = new Map(clips.map((c) => [c.id, c.title]));

  return groups.map((group) => ({
    id: group.id,
    clipSuggestionId: group.clipSuggestionId,
    clipTitle: clipTitle.get(group.clipSuggestionId) || "Clip",
    status: group.status,
    scheduledFor: group.scheduledFor!.toISOString(),
    createdAt: group.createdAt.toISOString(),
    jobs: group.jobs.map((job) => ({
      id: job.id,
      platform: job.platform,
      status: job.status,
      account: job.connectedSocialAccount,
    })),
  }));
}

export async function retryPublishJob(userId: string, jobId: string) {
  const job = await prisma.socialPublishJob.findFirst({
    where: { id: jobId, publishGroup: { userId } },
  });
  if (!job) throw new Error("Publish job not found");
  if (job.status === "completed") throw new Error("Job already completed");
  if (job.errorCode === "needs_reauth") {
    throw new Error("Reconnect the account before retrying");
  }

  await prisma.socialPublishJob.update({
    where: { id: jobId },
    data: {
      status: "queued",
      errorCode: null,
      errorMessage: null,
      failedAt: null,
      lockedAt: null,
      lockedBy: null,
    },
  });
  await prisma.socialPublishGroup.update({
    where: { id: job.publishGroupId },
    data: { status: "publishing" },
  });
  await appendEvent(jobId, "retry", "Job re-queued for retry");
  return getPublishGroup(job.publishGroupId, userId);
}

async function refreshGroupStatus(groupId: string) {
  const jobs = await prisma.socialPublishJob.findMany({
    where: { publishGroupId: groupId },
    select: { status: true },
  });
  const statuses = jobs.map((j) => j.status);
  let status = "publishing";
  if (statuses.every((s) => s === "completed")) status = "completed";
  else if (statuses.every((s) => s === "failed" || s === "cancelled")) status = "failed";
  else if (
    statuses.some((s) => s === "completed") &&
    statuses.some((s) => s === "failed")
  ) {
    status = "partially_completed";
  } else if (statuses.every((s) => s === "cancelled")) status = "cancelled";
  else if (statuses.some((s) => s === "scheduled") && statuses.every((s) => ["scheduled", "cancelled", "completed", "failed"].includes(s))) {
    status = "scheduled";
  }

  await prisma.socialPublishGroup.update({
    where: { id: groupId },
    data: { status },
  });
}

const SOCIAL_WORKER_ID = `social-${process.pid}-${randomUUID().slice(0, 8)}`;

export async function reclaimStaleSocialPublishJobs(): Promise<number> {
  const cutoff = new Date(Date.now() - 15 * 60 * 1000);
  const stale = await prisma.socialPublishJob.findMany({
    where: {
      status: { in: ["preparing_media", "uploading", "processing", "publishing"] },
      OR: [{ lockedAt: { lt: cutoff } }, { lockedAt: null, updatedAt: { lt: cutoff } }],
    },
    take: 20,
  });

  let reclaimed = 0;
  for (const job of stale) {
    const nextStatus = job.attemptCount >= job.maxAttempts ? "failed" : "queued";
    await prisma.socialPublishJob.update({
      where: { id: job.id },
      data: {
        status: nextStatus,
        lockedAt: null,
        lockedBy: null,
        errorMessage:
          nextStatus === "failed"
            ? "Publishing timed out or worker restarted too many times"
            : null,
        failedAt: nextStatus === "failed" ? new Date() : null,
      },
    });
    await appendEvent(
      job.id,
      "reclaimed",
      nextStatus === "failed" ? "Gave up after stale lock" : "Re-queued after stale lock"
    );
    await refreshGroupStatus(job.publishGroupId);
    reclaimed += 1;
  }
  return reclaimed;
}

export async function claimNextSocialPublishJob(): Promise<string | null> {
  const now = new Date();
  const candidates = await prisma.socialPublishJob.findMany({
    where: {
      OR: [
        { status: "queued" },
        { status: "scheduled", scheduledFor: { lte: now } },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: 8,
    select: { id: true, attemptCount: true, maxAttempts: true },
  });

  for (const candidate of candidates) {
    if (candidate.attemptCount >= candidate.maxAttempts) {
      await prisma.socialPublishJob.update({
        where: { id: candidate.id },
        data: {
          status: "failed",
          errorCode: "max_attempts",
          errorMessage: "Exceeded maximum publish attempts",
          failedAt: new Date(),
        },
      });
      continue;
    }

    const claimed = await prisma.socialPublishJob.updateMany({
      where: {
        id: candidate.id,
        status: { in: ["queued", "scheduled"] },
      },
      data: {
        status: "preparing_media",
        lockedAt: new Date(),
        lockedBy: SOCIAL_WORKER_ID,
        startedAt: new Date(),
        attemptCount: { increment: 1 },
      },
    });
    if (claimed.count === 1) return candidate.id;
  }
  return null;
}

export async function executeSocialPublishJob(jobId: string): Promise<void> {
  const job = await prisma.socialPublishJob.findUnique({
    where: { id: jobId },
  });
  if (!job) return;

  try {
    await appendEvent(jobId, "preparing_media", "Preparing media for upload");
    const settings = asSettings(job.publishSettings);
    const content = asContent(job.editedContent ?? job.generatedContent, job.platform as SocialPlatform);

    let media: PreparedMedia;
    if (job.videoPath && existsSync(job.videoPath)) {
      media = {
        filePath: job.videoPath,
        mimeType: "video/mp4",
        fileSizeBytes: 0,
        platformExportId: job.platformExportId,
      };
    } else {
      media = await resolvePublishMedia({
        clipSuggestionId: (
          await prisma.socialPublishGroup.findUniqueOrThrow({
            where: { id: job.publishGroupId },
            select: { clipSuggestionId: true },
          })
        ).clipSuggestionId,
        platform: job.platform as SocialPlatform,
        youtubeFormat: settings.youtubeFormat,
      });
      await prisma.socialPublishJob.update({
        where: { id: jobId },
        data: {
          videoPath: media.filePath,
          platformExportId: media.platformExportId,
        },
      });
    }

    const validation = validateSocialPost({
      platform: job.platform as SocialPlatform,
      content,
      settings,
      media,
    });
    if (!validation.ok) {
      throw new Error(
        validation.warnings.find((w) => w.severity === "error")?.message ||
          "Validation failed"
      );
    }

    await prisma.socialPublishJob.update({
      where: { id: jobId },
      data: { status: "uploading", validationWarnings: asJson(validation.warnings) },
    });
    await appendEvent(jobId, "uploading", "Uploading media to platform");

    const ctx = await getPublisherContext(job.connectedSocialAccountId);
    const publisher = getSocialPublisher(job.platform as SocialPlatform);

    // Idempotency: if we already have a post id, verify instead of re-uploading
    if (job.platformPostId) {
      const status = await publisher.getPublishStatus(ctx, job.platformPostId);
      if (status.state === "published") {
        await prisma.socialPublishJob.update({
          where: { id: jobId },
          data: {
            status: "completed",
            platformPostUrl: status.platformPostUrl || job.platformPostUrl,
            completedAt: new Date(),
            lockedAt: null,
            lockedBy: null,
            errorCode: null,
            errorMessage: null,
          },
        });
        await appendEvent(jobId, "completed", "Existing platform post confirmed");
        await refreshGroupStatus(job.publishGroupId);
        return;
      }
    }

    const result = await publisher.publish(ctx, {
      media,
      content,
      settings,
      idempotencyKey: job.idempotencyKey,
      existingUploadId: job.platformUploadId,
      existingPostId: job.platformPostId,
    });

    if (!result.success) {
      await prisma.socialPublishJob.update({
        where: { id: jobId },
        data: {
          status: "failed",
          errorCode: result.errorCode || "publish_failed",
          errorMessage: result.errorMessage || "Publish failed",
          platformUploadId: result.platformUploadId || job.platformUploadId,
          platformPostId: result.platformPostId || job.platformPostId,
          failedAt: new Date(),
          lockedAt: null,
          lockedBy: null,
          rawPlatformResponse: result.rawSafeResponse
            ? asJson(result.rawSafeResponse)
            : undefined,
        },
      });
      await appendEvent(jobId, "failed", result.errorMessage || "Publish failed", {
        errorCode: result.errorCode,
        needsReauth: result.needsReauth,
      });
      await refreshGroupStatus(job.publishGroupId);
      return;
    }

    await prisma.socialPublishJob.update({
      where: { id: jobId },
      data: {
        status: "completed",
        platformUploadId: result.platformUploadId || job.platformUploadId,
        platformMediaId: result.platformMediaId || job.platformMediaId,
        platformPostId: result.platformPostId,
        platformPostUrl: result.platformPostUrl,
        completedAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        errorCode: null,
        errorMessage: null,
        rawPlatformResponse: result.rawSafeResponse
          ? asJson(result.rawSafeResponse)
          : undefined,
      },
    });
    await appendEvent(jobId, "completed", "Published successfully", {
      platformPostId: result.platformPostId,
      privacyStatus: result.privacyStatus,
    });
    await refreshGroupStatus(job.publishGroupId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Publish failed";
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code: string }).code)
        : "publish_failed";
    await prisma.socialPublishJob.update({
      where: { id: jobId },
      data: {
        status: "failed",
        errorCode: code,
        errorMessage: message,
        failedAt: new Date(),
        lockedAt: null,
        lockedBy: null,
      },
    });
    await appendEvent(jobId, "failed", message, { errorCode: code });
    const jobRow = await prisma.socialPublishJob.findUnique({
      where: { id: jobId },
      select: { publishGroupId: true },
    });
    if (jobRow) await refreshGroupStatus(jobRow.publishGroupId);
  }
}

export async function failSocialPublishJob(jobId: string, message: string) {
  const job = await prisma.socialPublishJob.update({
    where: { id: jobId },
    data: {
      status: "failed",
      errorMessage: message,
      failedAt: new Date(),
      lockedAt: null,
      lockedBy: null,
    },
  });
  await appendEvent(jobId, "failed", message);
  await refreshGroupStatus(job.publishGroupId);
}
