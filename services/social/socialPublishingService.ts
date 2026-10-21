import { socialExportTarget, needsSeparateSocialFormat } from "@/lib/social/exportTarget";
import type { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "crypto";
import { existsSync } from "fs";
import { stat } from "fs/promises";
import { probeMedia } from "@/lib/ffmpeg";
import { decryptSecret, encryptSecret } from "@/lib/social/tokenCrypto";
import { ACTIVE_PUBLISH_STATUSES, EDITABLE_PUBLISH_STATUSES, assertTikTokPostConsent, requiresPostReview, safePublishError, socialGroupStatus } from "@/lib/social/publishingPolicy";
import { prisma } from "@/lib/db";
import { isPreviewRenderJobParams } from "@/lib/renderJobSelection";
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
import { getPostHogClient } from "@/lib/posthog-server";

function unsealUploadId(value: string | null): string | null {
  return value?.startsWith("enc:") ? decryptSecret(value.slice(4)) : value;
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function asContent(value: unknown, platform: SocialPlatform): SocialGeneratedContent {
  const content = emptySocialContent(platform);
  if (!value || typeof value !== "object" || Array.isArray(value)) return content;
  const raw = value as Record<string, unknown>;
  for (const key of ["title", "caption", "description", "postText", "thumbnailText", "pinnedComment", "redditTitle", "redditBody", "reasoningSummary"] as const) {
    if (typeof raw[key] === "string") content[key] = raw[key].slice(0, 20_000);
  }
  for (const key of ["hashtags", "tags"] as const) {
    if (Array.isArray(raw[key])) content[key] = raw[key].filter((item): item is string => typeof item === "string").slice(0, 100);
  }
  content.contentWarning = raw.contentWarning === true;
  return content;
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

async function capturePublishCompleted(jobId: string) {
  try {
    const job = await prisma.socialPublishJob.findUnique({
      where: { id: jobId },
      select: {
        platform: true,
        publishGroup: {
          select: {
            clipSuggestionId: true,
            userId: true,
            user: {
              select: { billingAccount: { select: { id: true } } },
            },
          },
        },
      },
    });
    if (!job) return;

    const distinctId =
      job.publishGroup.user.billingAccount?.id ?? job.publishGroup.userId;
    const client = getPostHogClient();
    client.capture({
      distinctId,
      event: "clip_published",
      properties: {
        clip_id: job.publishGroup.clipSuggestionId,
        platform: job.platform,
        $insert_id: `${jobId}:clip_published`,
      },
    });
    client.capture({
      distinctId,
      event: "first_clip_published",
      properties: {
        clip_id: job.publishGroup.clipSuggestionId,
        platform: job.platform,
        $insert_id: `${distinctId}:first_clip_published`,
      },
    });
  } catch (error) {
    console.warn("[analytics] Could not capture publish completion:", error);
  }
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
  instagramFormat?: "reel" | "feed";
  facebookFormat?: "reel" | "page_video";
  platformExportId?: string | null;
}): Promise<PreparedMedia> {
  const clip = await loadClipContext(options.clipSuggestionId);
  const preferredExportKey = socialExportTarget(options.platform, options);

  const match = options.platformExportId
    ? clip.platformExports.find((item) => item.id === options.platformExportId && item.platform === preferredExportKey && item.outputPath)
    : preferredExportKey
    ? clip.platformExports.find((item) => item.platform === preferredExportKey && item.outputPath)
    : null;

  if (options.platformExportId && !match) throw new Error("The selected platform export is not ready for this clip.");
  if (match?.outputPath) {
    const filePath = resolveStoragePath(match.outputPath);
    return inspectPublishMedia(filePath, match.id);
  }

  if (needsSeparateSocialFormat(preferredExportKey)) throw new Error("Prepare the selected platform format before posting this clip.");
  const render = clip.renderJobs.find(
    (job) => job.outputPath && !isPreviewRenderJobParams(job.params)
  );
  if (!render?.outputPath) {
    throw new Error("No completed render found for this clip");
  }
  const filePath = resolveStoragePath(render.outputPath);
  if (!existsSync(filePath)) {
    throw new Error("Rendered clip file is missing on disk");
  }
  return inspectPublishMedia(filePath, null);
}

export async function inspectPublishMedia(filePath: string, platformExportId: string | null): Promise<PreparedMedia> {
  const [file, probe] = await Promise.all([stat(filePath), probeMedia(filePath)]);
  if (!file.isFile() || file.size <= 0 || !probe.videoCodec || probe.durationSeconds <= 0) {
    throw new Error("The selected export is not a playable video. Render this clip again.");
  }
  return { filePath, platformExportId, mimeType: "video/mp4", fileSizeBytes: file.size,
    width: probe.width, height: probe.height, durationSeconds: probe.durationSeconds };
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

const creatingGroups = new Map<string, Promise<Awaited<ReturnType<typeof createPublishGroupInternal>>>>();
export async function createPublishGroup(options: Parameters<typeof createPublishGroupInternal>[0]) {
  if (!options.requestKey) return createPublishGroupInternal(options);
  const key = JSON.stringify([options.userId, options.clipSuggestionId, options.requestKey]);
  const existing = creatingGroups.get(key);
  if (existing) return existing;
  const work = createPublishGroupInternal(options);
  creatingGroups.set(key, work);
  try { return await work; } finally { if (creatingGroups.get(key) === work) creatingGroups.delete(key); }
}

async function createPublishGroupInternal(options: {
  userId: string;
  clipSuggestionId: string;
  requestKey?: string;
  destinations: Array<{
    connectedSocialAccountId: string;
    platform: SocialPlatform;
    destinationId?: string | null;
    platformExportId?: string | null;
    settings?: SocialPublishSettings;
    content?: SocialGeneratedContent;
  }>;
}) {
  if (!options.destinations.length) {
    throw new Error("Select at least one destination");
  }

  if (options.destinations.length > 20 || new Set(options.destinations.map((d) => d.connectedSocialAccountId)).size !== options.destinations.length) {
    throw new Error("Select each destination account only once (maximum 20).");
  }
  const groupId = `pub_${createHash("sha256").update(JSON.stringify([options.userId, options.clipSuggestionId, options.requestKey || randomUUID()])).digest("hex").slice(0, 40)}`;
  const existing = await getPublishGroup(groupId, options.userId);
  if (existing) return existing;
  const clip = await loadClipContext(options.clipSuggestionId);
  const transcript = await gatherTranscript(
    clip.streamSessionId,
    clip.startTimeSeconds,
    clip.endTimeSeconds
  );
  const prefs = await getPublishingPreferences(options.userId);

  const jobs = [];
  const generatedByPlatform = new Map<string, SocialGeneratedContent>();
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

    if (dest.destinationId && dest.destinationId !== account.platformAccountId) throw new Error("Destination does not belong to the connected account.");
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
      postConsent: false,
    };
    if (forcesPrivateUploads(dest.platform)) settings.privacy = "private";

    const media = await resolvePublishMedia({
      clipSuggestionId: clip.id,
      platform: dest.platform,
      youtubeFormat: settings.youtubeFormat,
      instagramFormat: settings.instagramFormat,
      facebookFormat: settings.facebookFormat,
      platformExportId: dest.platformExportId,
    });

    const copyKey = `${dest.platform}:${settings.youtubeFormat}:${settings.instagramFormat}`;
    let content = dest.content
      ? asContent(dest.content, dest.platform)
      : generatedByPlatform.get(copyKey) ?? await generateSocialContent({
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

    if (!dest.content) generatedByPlatform.set(copyKey, content);
    if (!dest.content && prefs.defaultHashtags.length) {
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

    jobs.push({
      connectedSocialAccountId: account.id, platform: dest.platform,
      destinationId: account.platformAccountId,
      status: requiresPostReview(dest.platform) ? "awaiting_consent" : "draft",
      idempotencyKey: `pub_${groupId}_${account.id}`,
      platformExportId: media.platformExportId, videoPath: media.filePath,
      generatedContent: asJson(content), editedContent: asJson(content),
      publishSettings: asJson(settings), validationWarnings: asJson(validation.warnings),
      events: { create: { type: "created", message: "Publish draft prepared" } },
    });
  }
  try {
    await prisma.socialPublishGroup.create({ data: {
      id: groupId, userId: options.userId, clipSuggestionId: options.clipSuggestionId,
      status: "awaiting_review", jobs: { create: jobs },
    } });
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "P2002")) throw error;
    // Another worker/request already created this exact operation.
    if (!await getPublishGroup(groupId, options.userId)) throw error;
  }
  return getPublishGroup(groupId, options.userId);
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
  if (!EDITABLE_PUBLISH_STATUSES.includes(job.status)) {
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

  settings.postConsent = false;
  const media = job.videoPath ? await inspectPublishMedia(job.videoPath, job.platformExportId) : null;

  const validation = validateSocialPost({
    platform: job.platform as SocialPlatform,
    content,
    settings,
    media,
  });

  const updated = await prisma.socialPublishJob.updateMany({
    where: { id: jobId, status: { in: EDITABLE_PUBLISH_STATUSES }, updatedAt: job.updatedAt },
    data: {
      editedContent: asJson(content),
      publishSettings: asJson(settings),
      validationWarnings: asJson(validation.warnings),
    },
  });

  if (updated.count !== 1) throw new Error("The post changed while saving. Reload it before editing.");
  return getPublishGroup(job.publishGroupId, userId);
}

export async function regeneratePublishJobContent(userId: string, jobId: string) {
  const job = await prisma.socialPublishJob.findFirst({
    where: { id: jobId, publishGroup: { userId } },
    include: { publishGroup: true },
  });
  if (!job) throw new Error("Publish job not found");

  if (!EDITABLE_PUBLISH_STATUSES.includes(job.status)) throw new Error("This post can no longer be edited.");
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
    if (![...EDITABLE_PUBLISH_STATUSES, "scheduled"].includes(job.status)) continue;
    const media = job.videoPath ? await inspectPublishMedia(job.videoPath, job.platformExportId) : null;
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
  source?: "manual" | "autopilot";
  consentJobIds?: string[];
}) {
  const group = await prisma.socialPublishGroup.findFirst({
    where: { id: options.groupId, userId: options.userId },
    include: { jobs: true },
  });
  if (!group) throw new Error("Publish group not found");

  if (options.mode === "schedule" && (!options.scheduledFor || !Number.isFinite(options.scheduledFor.getTime()) || options.scheduledFor.getTime() <= Date.now())) throw new Error("scheduledFor must be a future time");
  const reviewable = group.jobs.filter((job) => [...EDITABLE_PUBLISH_STATUSES, "scheduled"].includes(job.status));
  const eligible = reviewable.filter((job) => options.source !== "autopilot" || !requiresPostReview(job.platform as SocialPlatform));
  for (const job of eligible) {
    if (requiresPostReview(job.platform as SocialPlatform)) {
      if (!options.consentJobIds?.includes(job.id)) throw new Error("Review and confirm each TikTok post before publishing.");
      assertTikTokPostConsent({ ...asSettings(job.publishSettings), postConsent: true });
      await prisma.socialPublishJob.update({ where: { id: job.id }, data: {
        publishSettings: asJson({ ...asSettings(job.publishSettings), postConsent: true }),
      } });
    }
  }
  if (!eligible.length) {
    await refreshGroupStatus(group.id);
    return getPublishGroup(group.id, options.userId);
  }
  const eligibleIds = eligible.map((job) => job.id);
  const validated = await validatePublishGroup(options.userId, options.groupId);
  const blocking = (validated?.jobs || []).filter((job) => eligibleIds.includes(job.id)).flatMap((job) => {
    const warnings = Array.isArray(job.validationWarnings)
      ? (job.validationWarnings as unknown as SocialValidationWarning[])
      : [];
    return warnings.filter((w) => w.severity === "error");
  });
  if (blocking.length > 0) {
    throw new Error("Fix validation errors before publishing");
  }

  if (options.mode === "schedule") {
    if (!options.scheduledFor || !Number.isFinite(options.scheduledFor.getTime()) || options.scheduledFor.getTime() <= Date.now()) {
      throw new Error("scheduledFor must be a future time");
    }
    await prisma.socialPublishGroup.update({
      where: { id: group.id },
      data: { status: "scheduled", scheduledFor: options.scheduledFor },
    });
    await prisma.socialPublishJob.updateMany({
      where: {
        publishGroupId: group.id,
        id: { in: eligibleIds },
        status: { in: EDITABLE_PUBLISH_STATUSES },
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
        id: { in: eligibleIds },
        status: { in: [...EDITABLE_PUBLISH_STATUSES, "scheduled"] },
      },
      data: {
        status: "queued",
        scheduledFor: null,
        errorCode: null,
        errorMessage: null,
      },
    });
  }

  for (const job of eligible) {
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
  await refreshGroupStatus(groupId);
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
  if (job.status !== "failed") throw new Error("Only a failed post can be retried.");
  if (job.errorCode === "outcome_unknown") throw new Error("Check the platform before creating a new post; its previous result is uncertain.");
  if (job.platformPostId) throw new Error("The platform could not publish this upload. Start a new review draft after correcting the problem.");
  if (job.attemptCount >= job.maxAttempts) throw new Error("Maximum attempts reached. Review this post before starting a new one.");
  if (job.errorCode === "needs_reauth") {
    const account = await prisma.connectedSocialAccount.findUnique({ where: { id: job.connectedSocialAccountId }, select: { isActive: true, connectionError: true } });
    if (!account?.isActive || account.connectionError) throw new Error("Reconnect the account before retrying");
  }

  const updated = await prisma.socialPublishJob.updateMany({
    where: { id: jobId, status: "failed", lockedBy: null },
    data: {
      status: "queued",
      errorCode: null,
      errorMessage: null,
      failedAt: null,
      lockedAt: null,
      lockedBy: null,
    },
  });
  if (updated.count !== 1) throw new Error("This post is already being retried.");
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
  const status = socialGroupStatus(jobs.map((j) => j.status));

  await prisma.socialPublishGroup.update({
    where: { id: groupId },
    data: { status },
  });
  if (status === "completed") {
    await prisma.streamAutomationClip.updateMany({ where: { publishGroupId: groupId, status: "awaiting_review" }, data: { status: "completed", errorMessage: null } });
  }
}

const SOCIAL_WORKER_ID = `social-${process.pid}-${randomUUID().slice(0, 8)}`;

export async function reclaimStaleSocialPublishJobs(): Promise<number> {
  const cutoff = new Date(Date.now() - 5 * 60 * 1000);
  const stale = await prisma.socialPublishJob.findMany({ where: {
    status: { in: ACTIVE_PUBLISH_STATUSES }, lockedBy: { not: null },
    OR: [{ lockedAt: { lt: cutoff } }, { lockedAt: null, updatedAt: { lt: cutoff } }],
  }, take: 20 });
  let reclaimed = 0;
  for (const job of stale) {
    const uncertain = job.errorCode === "commit_in_flight" && !job.platformPostId;
    const result = await prisma.socialPublishJob.updateMany({ where: { id: job.id, lockedBy: job.lockedBy, lockedAt: job.lockedAt }, data: {
      status: uncertain ? "outcome_unknown" : "queued", lockedBy: null, lockedAt: null,
      errorCode: uncertain ? "outcome_unknown" : null,
      errorMessage: uncertain ? "The platform may have received this post. Check your account before creating another." : null,
    } });
    if (result.count) { await refreshGroupStatus(job.publishGroupId); reclaimed++; }
  }
  return reclaimed;
}

export async function claimNextSocialPublishJob(): Promise<string | null> {
  const now = new Date();
  const candidates = await prisma.socialPublishJob.findMany({ where: { lockedBy: null, OR: [
    { status: "queued" }, { status: "scheduled", scheduledFor: { lte: now } },
    { status: "processing", scheduledFor: { lte: now } },
  ] }, orderBy: { createdAt: "asc" }, take: 8 });
  for (const candidate of candidates) {
    const polling = candidate.status === "processing";
    if (!polling && candidate.attemptCount >= candidate.maxAttempts) {
      await failSocialPublishJob(candidate.id, "Exceeded maximum publish attempts");
      continue;
    }
    const claimed = await prisma.socialPublishJob.updateMany({ where: {
      id: candidate.id, status: candidate.status, lockedBy: null,
      ...(candidate.status === "queued" ? {} : { scheduledFor: { lte: now } }),
    }, data: { status: "preparing_media", lockedAt: now, lockedBy: SOCIAL_WORKER_ID,
      startedAt: candidate.startedAt || now, ...(polling ? {} : { attemptCount: { increment: 1 } }),
    } });
    if (claimed.count === 1) return candidate.id;
  }
  return null;
}

export async function executeSocialPublishJob(jobId: string): Promise<void> {
  const job = await prisma.socialPublishJob.findUnique({ where: { id: jobId } });
  if (!job || job.lockedBy !== SOCIAL_WORKER_ID || job.status !== "preparing_media") return;
  let committing = job.errorCode === "commit_in_flight";
  let postId = job.platformPostId;
  const ownedUpdate = async (data: Prisma.SocialPublishJobUncheckedUpdateManyInput) => {
    const updated = await prisma.socialPublishJob.updateMany({ where: { id: jobId, lockedBy: SOCIAL_WORKER_ID }, data });
    if (updated.count !== 1) throw new Error("Publishing lease lost");
  };
  const heartbeat = setInterval(() => { void ownedUpdate({ lockedAt: new Date() }).catch(() => undefined); }, 30_000);
  heartbeat.unref?.();
  try {
    if (!canPublishPlatform(job.platform as SocialPlatform)) throw new Error("Publishing is unavailable for this platform. Check the connected account.");
    const settings = asSettings(job.publishSettings);
    if (requiresPostReview(job.platform as SocialPlatform)) assertTikTokPostConsent(settings);
    if (forcesPrivateUploads(job.platform as SocialPlatform)) settings.privacy = "private";
    const ctx = { ...await getPublisherContext(job.connectedSocialAccountId), destinationId: job.destinationId };
    const publisher = getSocialPublisher(job.platform as SocialPlatform);
    let result: import("@/lib/social/types").PublishResult;
    // Once the remote post exists, all subsequent work is status polling, never upload.
    if (postId) {
      const status = await publisher.getPublishStatus(ctx, job.platform === "tiktok" ? unsealUploadId(job.platformUploadId) || postId : postId);
      result = { success: status.state !== "failed", state: status.state === "published" ? "published" : status.state === "awaiting_user" ? "awaiting_user" : "processing",
        platformPostId: status.platformPostId || postId, platformPostUrl: status.platformPostUrl,
        errorMessage: status.errorMessage, errorCode: status.state === "failed" ? "processing_failed" : undefined };
    } else {
      const media = job.videoPath
        ? await inspectPublishMedia(job.videoPath, job.platformExportId)
        : await resolvePublishMedia({ clipSuggestionId: (await prisma.socialPublishGroup.findUniqueOrThrow({ where: { id: job.publishGroupId }, select: { clipSuggestionId: true } })).clipSuggestionId,
            platform: job.platform as SocialPlatform, youtubeFormat: settings.youtubeFormat, instagramFormat: settings.instagramFormat, facebookFormat: settings.facebookFormat });
      const content = asContent(job.editedContent ?? job.generatedContent, job.platform as SocialPlatform);
      const request: import("@/lib/social/SocialPublisher").PublishRequest = {
        media, content, settings, idempotencyKey: job.idempotencyKey,
        existingUploadId: unsealUploadId(job.platformUploadId),
        existingPostId: postId, existingMediaId: job.platformMediaId,
        checkpoint: async (checkpoint) => {
          if (checkpoint.committing != null) committing = checkpoint.committing;
          if (checkpoint.platformPostId) postId = checkpoint.platformPostId;
          await ownedUpdate({
            ...(checkpoint.platformUploadId ? { platformUploadId: `enc:${encryptSecret(checkpoint.platformUploadId)}` } : {}),
            ...(checkpoint.platformMediaId ? { platformMediaId: checkpoint.platformMediaId } : {}),
            ...(checkpoint.platformPostId ? { platformPostId: checkpoint.platformPostId } : {}),
            errorCode: committing && !postId ? "commit_in_flight" : null, lockedAt: new Date(),
          });
        },
      };
      const validation = validateSocialPost({ platform: job.platform as SocialPlatform, content, settings, media });
      const remote = await publisher.validatePost(ctx, request);
      const warnings = [...validation.warnings, ...remote.warnings];
      if (!validation.ok || !remote.ok) throw new Error(warnings.find((w) => w.severity === "error")?.message || "Post validation failed");
      await ownedUpdate({ status: "uploading", videoPath: media.filePath, platformExportId: media.platformExportId, validationWarnings: asJson(warnings) });
      result = await publisher.publish(ctx, request);
    }
    if (result.needsReauth) await prisma.connectedSocialAccount.update({ where: { id: job.connectedSocialAccountId }, data: { connectionError: "Reconnect this account to resume publishing." } });
    const uncertain = !result.success && committing && !postId && !result.platformPostId;
    const state = !result.success ? (uncertain ? "outcome_unknown" : "failed") : result.state === "processing" ? "processing" : result.state === "awaiting_user" ? "awaiting_user" : "completed";
    // Provider processing can take minutes. Release the worker and poll later.
    const processingExpired = state === "processing" && job.startedAt && Date.now() - job.startedAt.getTime() > 24 * 60 * 60 * 1000;
    await ownedUpdate({ status: processingExpired ? "outcome_unknown" : state,
      ...(result.platformUploadId ? { platformUploadId: `enc:${encryptSecret(result.platformUploadId)}` } : {}),
      ...(result.platformMediaId ? { platformMediaId: result.platformMediaId } : {}),
      ...(result.platformPostId ? { platformPostId: result.platformPostId } : {}),
      ...(result.platformPostUrl ? { platformPostUrl: result.platformPostUrl } : {}),
      completedAt: state === "completed" ? new Date() : null, failedAt: state === "failed" ? new Date() : null,
      scheduledFor: state === "processing" && !processingExpired ? new Date(Date.now() + 30_000) : null,
      lockedAt: null, lockedBy: null,
      errorCode: uncertain || processingExpired ? "outcome_unknown" : result.success ? null : result.needsReauth ? "needs_reauth" : result.errorCode || "publish_failed",
      errorMessage: uncertain || processingExpired ? "Check the platform before creating another post; its result could not be confirmed." : result.errorMessage ? safePublishError(result.errorMessage) : null,
      rawPlatformResponse: result.rawSafeResponse ? asJson(result.rawSafeResponse) : undefined,
    });
    if (state !== "processing") await appendEvent(jobId, state, state === "completed" ? "Platform confirmed the post" : state === "awaiting_user" ? "Delivered to TikTok inbox. Finish posting in TikTok." : "Publishing needs attention");
    await refreshGroupStatus(job.publishGroupId);
    if (state === "completed") await capturePublishCompleted(jobId);
  } catch (error) {
    const uncertain = committing && !postId;
    const expired = Boolean(postId && job.startedAt && Date.now() - job.startedAt.getTime() > 24 * 60 * 60 * 1000);
    const message = safePublishError(error instanceof Error ? error.message : "Publish failed");
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "publish_failed";
    await ownedUpdate({ status: uncertain || expired ? "outcome_unknown" : postId ? "processing" : "failed",
      errorCode: uncertain || expired ? "outcome_unknown" : code, errorMessage: message,
      scheduledFor: postId && !expired ? new Date(Date.now() + 60_000) : null,
      failedAt: !postId && !uncertain ? new Date() : null, lockedAt: null, lockedBy: null,
    }).catch(() => undefined);
    await refreshGroupStatus(job.publishGroupId);
  } finally { clearInterval(heartbeat); }
}

export async function failSocialPublishJob(jobId: string, message: string) {
  const job = await prisma.socialPublishJob.update({ where: { id: jobId }, data: {
    status: "failed", errorMessage: safePublishError(message), failedAt: new Date(), lockedAt: null, lockedBy: null,
  } });
  await appendEvent(jobId, "failed", safePublishError(message));
  await refreshGroupStatus(job.publishGroupId);
}
