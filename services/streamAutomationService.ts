import { randomUUID } from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  automationBroadcastKey,
  automationLiveProbeUrl,
  parseAutomationSource,
  parseDestinationAccountIds,
  sanitizeAutomationError,
  type ParsedAutomationSource,
} from "@/lib/liveAutomation";
import { normalizeYouTubeUrl } from "@/lib/youtube";
import { parseStreamUrl } from "@/lib/streamPlatform";
import { canPublishPlatform } from "@/lib/social/capabilities";
import { isSocialPlatform, type SocialPlatform } from "@/lib/social/types";
import { DEFAULT_CAPTION_APPEARANCE } from "@/lib/captionAppearance";
import { parsePostRenderQualityReview } from "@/lib/postRenderCritic";
import {
  LIVE_NOW_CONTEXT_OVERLAP_SECONDS,
  LIVE_NOW_ROLL_SECONDS,
} from "@/lib/agentWizard";
import { createStreamSession } from "@/services/youtubeService";
import {
  fetchStreamPlatformMetadata,
  fetchYtDlpMetadata,
  type YtDlpStreamMetadata,
} from "@/services/ytDlpMetadataService";
import {
  replacePriorSessionsForAccount,
  withAccountSessionLock,
} from "@/services/sessionCleanupService";
import { acquireSourceMedia, resolveSourceRecordedSeconds } from "@/services/liveRecordingService";
import { runLivePipeline } from "@/services/livePipelineService";
import { autoSuggestClips } from "@/services/suggestClipsService";
import {
  buildAutoVerticalLayoutRequest,
  prepareSuggestedClips,
} from "@/services/clipAutoPrepareService";
import {
  getVerticalLayoutConfiguration,
  requestFromVerticalLayoutConfiguration,
} from "@/services/verticalLayoutService";
import { createRenderJobRecord } from "@/services/renderService";
import { canCreateStreamSession, canRenderExport } from "@/services/usageService";
import { hasAppAccess } from "@/services/billingService";
import {
  createPublishGroup,
  enqueuePublishGroup,
} from "@/services/social/socialPublishingService";
import { prepareCaptionDirections } from "@/services/captionDirectorService";

const AUTOMATION_WORKER_ID = `autopilot-${process.pid}-${randomUUID().slice(0, 8)}`;
const FIRST_SUGGESTION_SECONDS = 45;
const MIN_AUTOPUBLISH_CONFIDENCE = 0.55;
const ACTIVE_FACE_ANALYSIS_STATUSES = new Set([
  "queued",
  "extracting_frames",
  "detecting_faces",
  "tracking_faces",
  "classifying_layout",
]);
let automationSchemaAvailable: boolean | null = null;
let automationSchemaCheckedAt = 0;

export class StreamAutomationSchemaPendingError extends Error {}

function pollIntervalMs(): number {
  return Math.max(
    30_000,
    Number.parseInt(process.env.STREAM_AUTOMATION_POLL_MS || "60000", 10) ||
      60_000
  );
}

function retryIntervalMs(): number {
  return Math.max(pollIntervalMs(), 2 * 60_000);
}

function lockCutoff(): Date {
  return new Date(Date.now() - 5 * 60_000);
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function isAutomationSchemaReady(): Promise<boolean> {
  if (
    automationSchemaAvailable !== null &&
    Date.now() - automationSchemaCheckedAt < 30_000
  ) {
    return automationSchemaAvailable;
  }
  const rows = await prisma.$queryRaw<
    Array<{ automation: string | null; clips: string | null }>
  >`SELECT to_regclass('"StreamAutomation"')::text AS automation, to_regclass('"StreamAutomationClip"')::text AS clips`;
  automationSchemaAvailable = Boolean(rows[0]?.automation && rows[0]?.clips);
  automationSchemaCheckedAt = Date.now();
  return automationSchemaAvailable;
}

async function findAutomationForUser(userId: string) {
  if (!(await isAutomationSchemaReady())) return null;
  return prisma.streamAutomation.findUnique({ where: { userId } });
}

async function probeSource(
  source: ParsedAutomationSource
): Promise<{ live: boolean; streamUrl: string | null; metadata: YtDlpStreamMetadata }> {
  if (source.platform === "youtube") {
    let metadata: YtDlpStreamMetadata;
    try {
      metadata = await fetchYtDlpMetadata(
        automationLiveProbeUrl(source),
        source.sourceKey
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/not currently live|no live streams?|is offline/i.test(message)) {
        metadata = {
          sourceId: source.sourceKey,
          title: `${source.sourceKey} (YouTube)`,
          description: "",
          channelTitle: source.sourceKey,
          channelId: "",
          thumbnailUrl: "",
          liveStatus: "none",
          actualStartTime: null,
          scheduledStartTime: null,
          concurrentViewers: null,
          durationSeconds: null,
          raw: {},
        };
      } else {
        throw error;
      }
    }
    return {
      live: metadata.liveStatus === "live",
      streamUrl:
        metadata.liveStatus === "live" && metadata.sourceId
          ? normalizeYouTubeUrl(metadata.sourceId)
          : null,
      metadata,
    };
  }

  const parsed = parseStreamUrl(source.sourceUrl);
  if (!parsed) throw new Error("The streaming account URL is no longer valid.");
  let metadata = await fetchStreamPlatformMetadata(parsed);

  // Kick's fast API path deliberately returns a fallback when app credentials
  // are absent. Autopilot still gets one direct live probe in that case.
  if (
    metadata.liveStatus === "none" &&
    metadata.raw.fallback === true
  ) {
    metadata = await fetchYtDlpMetadata(
      source.sourceUrl,
      source.sourceKey,
      parsed.embed
    );
  }

  return {
    live: metadata.liveStatus === "live",
    streamUrl: metadata.liveStatus === "live" ? source.sourceUrl : null,
    metadata,
  };
}

function serializeAutomation(automation: {
  id: string;
  platform: string;
  sourceUrl: string;
  displayName: string | null;
  enabled: boolean;
  autoPublishEnabled: boolean;
  clipsPerBroadcast: number;
  destinationAccountIds: unknown;
  activeSessionId: string | null;
  lastCheckedAt: Date | null;
  nextCheckAt: Date | null;
  lastLiveAt: Date | null;
  lastCompletedAt: Date | null;
  lastError: string | null;
}) {
  return {
    id: automation.id,
    platform: automation.platform,
    sourceUrl: automation.sourceUrl,
    displayName: automation.displayName,
    enabled: automation.enabled,
    autoPublishEnabled: automation.autoPublishEnabled,
    clipsPerBroadcast: automation.clipsPerBroadcast,
    destinationAccountIds: parseDestinationAccountIds(
      automation.destinationAccountIds
    ),
    activeSessionId: automation.activeSessionId,
    lastCheckedAt: automation.lastCheckedAt?.toISOString() ?? null,
    nextCheckAt: automation.nextCheckAt?.toISOString() ?? null,
    lastLiveAt: automation.lastLiveAt?.toISOString() ?? null,
    lastCompletedAt: automation.lastCompletedAt?.toISOString() ?? null,
    lastError: automation.lastError,
  };
}

export async function getStreamAutomationSettings(userId: string) {
  const [automation, destinations, youtubeSources] = await Promise.all([
    findAutomationForUser(userId),
    prisma.connectedSocialAccount.findMany({
      where: { userId, isActive: true },
      orderBy: [{ platform: "asc" }, { isDefault: "desc" }],
      select: {
        id: true,
        platform: true,
        displayName: true,
        username: true,
        avatarUrl: true,
      },
    }),
    prisma.connectedSocialAccount.findMany({
      where: { userId, platform: "youtube", isActive: true },
      select: {
        id: true,
        platformAccountId: true,
        displayName: true,
        username: true,
      },
    }),
  ]);

  return {
    automation: automation ? serializeAutomation(automation) : null,
    destinations: destinations
      .filter(
        (account) =>
          isSocialPlatform(account.platform) && canPublishPlatform(account.platform)
      )
      .map((account) => ({ ...account, platform: account.platform as SocialPlatform })),
    youtubeSources: youtubeSources.map((account) => ({
      id: account.id,
      label: account.displayName || account.username || "YouTube channel",
      sourceUrl: `https://www.youtube.com/channel/${account.platformAccountId}`,
    })),
  };
}

export async function saveStreamAutomationSettings(
  userId: string,
  input: {
    sourceUrl: string;
    enabled?: boolean;
    autoPublishEnabled?: boolean;
    clipsPerBroadcast?: number;
    destinationAccountIds?: unknown;
  }
) {
  const source = parseAutomationSource(input.sourceUrl);
  if (!source) {
    throw new Error(
      "Paste a YouTube channel, Twitch channel, or Kick channel URL."
    );
  }
  if (!(await isAutomationSchemaReady())) {
    throw new StreamAutomationSchemaPendingError(
      "Autopilot is waiting for the latest database update."
    );
  }

  const billing = await prisma.billingAccount.findUnique({
    where: { userId },
  });
  if (!billing || !hasAppAccess(billing)) {
    throw new Error("An active Clipper subscription is required.");
  }

  const enabled = input.enabled === true;
  const autoPublishEnabled = input.autoPublishEnabled === true;
  const clipsPerBroadcast = Math.max(
    1,
    Math.min(10, Math.round(input.clipsPerBroadcast ?? 3))
  );
  const requestedIds = parseDestinationAccountIds(input.destinationAccountIds);
  const accounts = requestedIds.length
    ? await prisma.connectedSocialAccount.findMany({
        where: { userId, isActive: true, id: { in: requestedIds } },
        select: { id: true, platform: true },
      })
    : [];
  const allowedIds = new Set(
    accounts
      .filter(
        (account) =>
          isSocialPlatform(account.platform) && canPublishPlatform(account.platform)
      )
      .map((account) => account.id)
  );
  const destinationAccountIds = requestedIds.filter((id) => allowedIds.has(id));

  if (enabled && autoPublishEnabled && destinationAccountIds.length === 0) {
    throw new Error("Choose at least one connected destination before auto-posting.");
  }

  const current = await prisma.streamAutomation.findUnique({ where: { userId } });
  const sourceChanged = Boolean(current && current.sourceKey !== source.sourceKey);
  const reset = sourceChanged
    ? {
        activeBroadcastKey: null,
        activeSessionId: null,
        lastSuggestedThroughSeconds: 0,
        lastError: null,
      }
    : {};
  const data = {
    platform: source.platform,
    sourceUrl: source.sourceUrl,
    sourceKey: source.sourceKey,
    displayName: source.sourceKey.replace(/^@/, ""),
    enabled,
    autoPublishEnabled,
    clipsPerBroadcast,
    destinationAccountIds: asJson(destinationAccountIds),
    nextCheckAt: enabled ? new Date() : null,
    lockedAt: null,
    lockedBy: null,
    ...reset,
  };

  const saved = current
    ? await prisma.streamAutomation.update({ where: { id: current.id }, data })
    : await prisma.streamAutomation.create({ data: { userId, ...data } });
  return serializeAutomation(saved);
}

export async function disableStreamAutomation(userId: string) {
  if (!(await isAutomationSchemaReady())) return null;
  const existing = await prisma.streamAutomation.findUnique({ where: { userId } });
  if (!existing) return null;
  const saved = await prisma.streamAutomation.update({
    where: { id: existing.id },
    data: {
      enabled: false,
      autoPublishEnabled: false,
      nextCheckAt: null,
      lockedAt: null,
      lockedBy: null,
    },
  });
  return serializeAutomation(saved);
}

async function destinationRows(automation: {
  userId: string;
  destinationAccountIds: unknown;
}) {
  const ids = parseDestinationAccountIds(automation.destinationAccountIds);
  if (!ids.length) return [];
  const accounts = await prisma.connectedSocialAccount.findMany({
    where: { userId: automation.userId, isActive: true, id: { in: ids } },
    select: { id: true, platform: true },
  });
  const byId = new Map(accounts.map((account) => [account.id, account]));
  return ids.flatMap((id) => {
    const account = byId.get(id);
    if (
      !account ||
      !isSocialPlatform(account.platform) ||
      !canPublishPlatform(account.platform)
    ) {
      return [];
    }
    return [
      {
        connectedSocialAccountId: account.id,
        platform: account.platform as SocialPlatform,
      },
    ];
  });
}

async function progressAutomationClip(): Promise<boolean> {
  const row = await prisma.streamAutomationClip.findFirst({
    where: { status: { in: ["preparing", "rendering", "publishing"] } },
    orderBy: { updatedAt: "asc" },
    include: { automation: true },
  });
  if (!row) return false;

  try {
    if (row.status === "preparing") {
      const clip = await prisma.clipSuggestion.findUnique({
        where: { id: row.clipSuggestionId },
      });
      if (!clip) throw new Error("The automated clip no longer exists.");

      const capturedSeconds = await resolveSourceRecordedSeconds(
        row.streamSessionId
      );
      if (capturedSeconds + 0.5 < clip.endTimeSeconds) return false;

      const faceJob = await prisma.faceAnalysisJob.findFirst({
        where: { clipSuggestionId: clip.id },
        orderBy: { createdAt: "desc" },
        select: { id: true, status: true },
      });
      if (faceJob && ACTIVE_FACE_ANALYSIS_STATUSES.has(faceJob.status)) {
        return false;
      }

      const billing = await prisma.billingAccount.findUnique({
        where: { userId: row.automation.userId },
      });
      const usage = await canRenderExport(
        billing?.id,
        1,
        clip.endTimeSeconds - clip.startTimeSeconds,
        clip.id
      );
      if (!usage.allowed) throw new Error(usage.message || "Video limit reached.");

      const sourceMedia = await prisma.sourceMedia.findFirst({
        where: { streamSessionId: row.streamSessionId },
        orderBy: { createdAt: "desc" },
      });
      const savedLayout = await getVerticalLayoutConfiguration(clip.id);
      const verticalLayout =
        (savedLayout
          ? requestFromVerticalLayoutConfiguration(savedLayout)
          : null) ??
        buildAutoVerticalLayoutRequest(
          faceJob?.status === "completed" ? faceJob.id : undefined
        );
      const renderJobId = await createRenderJobRecord({
        streamSessionId: row.streamSessionId,
        clipSuggestionId: clip.id,
        sourceMediaId: sourceMedia?.id,
        layout: clip.suggestedLayout,
        includeCaptions: true,
        renderParams: {
          streamSessionId: row.streamSessionId,
          sourceMediaId: sourceMedia?.id,
          clipSuggestionId: clip.id,
          startTimeSeconds: clip.startTimeSeconds,
          endTimeSeconds: clip.endTimeSeconds,
          format: "vertical",
          layout: "center_crop",
          includeCaptions: true,
          captionAppearance: DEFAULT_CAPTION_APPEARANCE,
          verticalLayout,
        },
      });
      await prisma.streamAutomationClip.update({
        where: { id: row.id },
        data: { status: "rendering", renderJobId, errorMessage: null },
      });
      return true;
    }

    if (row.status === "rendering") {
      if (!row.renderJobId) throw new Error("Automated render job is missing.");
      const render = await prisma.renderJob.findUnique({
        where: { id: row.renderJobId },
        select: { status: true, errorMessage: true, qualityReview: true },
      });
      if (!render) throw new Error("Automated render job no longer exists.");
      if (render.status === "failed" || render.status === "cancelled") {
        throw new Error(render.errorMessage || "Automated render failed.");
      }
      if (render.status !== "completed") return false;

      if (!row.automation.autoPublishEnabled) {
        await prisma.streamAutomationClip.update({
          where: { id: row.id },
          data: { status: "completed", errorMessage: null },
        });
        return true;
      }

      const qualityReview = parsePostRenderQualityReview(render.qualityReview);
      if (!qualityReview) {
        throw new Error(
          "Automatic posting paused because the export quality review was unavailable."
        );
      }
      if (qualityReview.verdict === "fail") {
        const problem =
          qualityReview.issues.find((issue) => issue.severity === "critical")
            ?.title ?? qualityReview.summary;
        throw new Error(`Automatic posting paused by export quality review: ${problem}`);
      }

      const destinations = await destinationRows(row.automation);
      if (!destinations.length) {
        throw new Error("No active publishing destination is selected.");
      }
      const group = await createPublishGroup({
        userId: row.automation.userId,
        clipSuggestionId: row.clipSuggestionId,
        destinations,
      });
      if (!group) throw new Error("Could not create an automatic publish group.");
      await enqueuePublishGroup({
        userId: row.automation.userId,
        groupId: group.id,
        mode: "now",
      });
      await prisma.streamAutomationClip.update({
        where: { id: row.id },
        data: {
          status: "publishing",
          publishGroupId: group.id,
          errorMessage: null,
        },
      });
      return true;
    }

    if (!row.publishGroupId) throw new Error("Automatic publish group is missing.");
    const group = await prisma.socialPublishGroup.findUnique({
      where: { id: row.publishGroupId },
      select: { status: true },
    });
    if (!group) throw new Error("Automatic publish group no longer exists.");
    if (group.status === "failed" || group.status === "cancelled") {
      throw new Error(`Automatic publishing ${group.status}.`);
    }
    if (group.status === "completed" || group.status === "partially_completed") {
      await prisma.$transaction([
        prisma.streamAutomationClip.update({
          where: { id: row.id },
          data: { status: "completed", errorMessage: null },
        }),
        prisma.streamAutomation.update({
          where: { id: row.automationId },
          data: { lastCompletedAt: new Date(), lastError: null },
        }),
      ]);
      return true;
    }
    return false;
  } catch (error) {
    const message = sanitizeAutomationError(error);
    await prisma.$transaction([
      prisma.streamAutomationClip.update({
        where: { id: row.id },
        data: { status: "failed", errorMessage: message },
      }),
      prisma.streamAutomation.update({
        where: { id: row.automationId },
        data: { lastError: message },
      }),
    ]);
    console.error(`[autopilot] clip ${row.id} failed: ${message}`);
    return true;
  }
}

async function claimDueAutomation() {
  const candidates = await prisma.streamAutomation.findMany({
    where: {
      enabled: true,
      AND: [
        { OR: [{ nextCheckAt: null }, { nextCheckAt: { lte: new Date() } }] },
        { OR: [{ lockedAt: null }, { lockedAt: { lt: lockCutoff() } }] },
      ],
    },
    orderBy: [{ nextCheckAt: "asc" }, { updatedAt: "asc" }],
    take: 5,
  });

  for (const candidate of candidates) {
    const claimed = await prisma.streamAutomation.updateMany({
      where: {
        id: candidate.id,
        enabled: true,
        OR: [{ lockedAt: null }, { lockedAt: { lt: lockCutoff() } }],
      },
      data: { lockedAt: new Date(), lockedBy: AUTOMATION_WORKER_ID },
    });
    if (claimed.count === 1) return candidate;
  }
  return null;
}

async function ensureBroadcastSession(
  automation: NonNullable<Awaited<ReturnType<typeof claimDueAutomation>>>,
  streamUrl: string,
  broadcastKey: string
): Promise<{ sessionId: string; created: boolean }> {
  if (
    automation.activeBroadcastKey === broadcastKey &&
    automation.activeSessionId
  ) {
    const exists = await prisma.streamSession.findUnique({
      where: { id: automation.activeSessionId },
      select: { id: true },
    });
    if (exists) return { sessionId: exists.id, created: false };
  }

  const billing = await prisma.billingAccount.findUnique({
    where: { userId: automation.userId },
  });
  if (!billing || !hasAppAccess(billing)) {
    throw new Error("Autopilot paused because this account no longer has access.");
  }
  const usage = await canCreateStreamSession(billing.id);
  if (!usage.allowed) throw new Error(usage.message || "Upload limit reached.");

  const session = await withAccountSessionLock(billing.id, async () => {
    const created = await createStreamSession(
      streamUrl,
      billing.id,
      usage.snapshot.entitlements?.maxSourceDurationSeconds,
      "agent"
    );
    await replacePriorSessionsForAccount(billing.id, created.id);
    return created;
  });
  await prisma.streamAutomation.update({
    where: { id: automation.id },
    data: {
      activeBroadcastKey: broadcastKey,
      activeSessionId: session.id,
      lastSuggestedThroughSeconds: 0,
      lastLiveAt: new Date(),
      lastError: null,
    },
  });
  return { sessionId: session.id, created: true };
}

async function monitorClaimedAutomation(
  automation: NonNullable<Awaited<ReturnType<typeof claimDueAutomation>>>
): Promise<boolean> {
  const source = parseAutomationSource(automation.sourceUrl);
  if (!source) throw new Error("The saved streaming account URL is invalid.");
  const probe = await probeSource(source);

  if (!probe.live || !probe.streamUrl) {
    if (automation.activeSessionId) {
      await prisma.streamSession
        .update({
          where: { id: automation.activeSessionId },
          data: { liveStatus: "post_live" },
        })
        .catch(() => null);
    }
    await prisma.streamAutomation.update({
      where: { id: automation.id },
      data: {
        activeBroadcastKey: null,
        activeSessionId: null,
        lastSuggestedThroughSeconds: 0,
      },
    });
    return false;
  }

  const broadcastKey = automationBroadcastKey({
    platform: source.platform,
    sourceId: probe.metadata.sourceId,
    actualStartTime: probe.metadata.actualStartTime,
    raw: probe.metadata.raw,
  });
  const session = await ensureBroadcastSession(
    automation,
    probe.streamUrl,
    broadcastKey
  );

  if (session.created) {
    await acquireSourceMedia(session.sessionId);
  } else {
    await runLivePipeline(session.sessionId);
  }

  const freshAutomation = await prisma.streamAutomation.findUnique({
    where: { id: automation.id },
  });
  if (!freshAutomation) return session.created;
  const through =
    (await prisma.transcriptChunk.aggregate({
      where: { streamSessionId: session.sessionId },
      _max: { endTimeSeconds: true },
    }))._max.endTimeSeconds ?? 0;
  const readyForFirst =
    freshAutomation.lastSuggestedThroughSeconds === 0 &&
    through >= FIRST_SUGGESTION_SECONDS;
  const readyForNext =
    through - freshAutomation.lastSuggestedThroughSeconds >=
    LIVE_NOW_ROLL_SECONDS;
  if (!readyForFirst && !readyForNext) return session.created;

  const automatedCount = await prisma.streamAutomationClip.count({
    where: { automationId: automation.id, broadcastKey },
  });
  if (automatedCount >= automation.clipsPerBroadcast) return session.created;

  const totalSuggestions = await prisma.clipSuggestion.count({
    where: { streamSessionId: session.sessionId, status: { not: "rejected" } },
  });
  if (totalSuggestions >= automation.clipsPerBroadcast * 5) {
    await prisma.streamAutomation.update({
      where: { id: automation.id },
      data: { lastSuggestedThroughSeconds: through },
    });
    return session.created;
  }

  const result = await autoSuggestClips(session.sessionId, 1, {
    fromSeconds: Math.max(
      0,
      freshAutomation.lastSuggestedThroughSeconds -
        LIVE_NOW_CONTEXT_OVERLAP_SECONDS
    ),
    throughSeconds: through,
  });
  await prisma.streamAutomation.update({
    where: { id: automation.id },
    data: { lastSuggestedThroughSeconds: through },
  });

  const chosen = result.clips
    .filter((clip) => clip.confidence >= MIN_AUTOPUBLISH_CONFIDENCE)
    .sort((a, b) => b.confidence - a.confidence)[0];
  if (!chosen) return result.created > 0 || session.created;

  await prisma.streamAutomationClip.upsert({
    where: { clipSuggestionId: chosen.id },
    create: {
      automationId: automation.id,
      broadcastKey,
      streamSessionId: session.sessionId,
      clipSuggestionId: chosen.id,
      status: "preparing",
    },
    update: {},
  });
  await prepareSuggestedClips(session.sessionId, [
    {
      id: chosen.id,
      startTimeSeconds: chosen.startTimeSeconds,
      endTimeSeconds: chosen.endTimeSeconds,
    },
  ]);
  await prepareCaptionDirections([chosen.id]);
  return true;
}

/** Progress one clip first, otherwise check one due creator account. */
export async function processOneStreamAutomation(): Promise<boolean> {
  // Production pushes the additive schema before Next.js starts. This quiet
  // check keeps local dev and rolling deploys idle until both tables exist.
  if (!(await isAutomationSchemaReady())) return false;
  const progressed = await progressAutomationClip();
  if (progressed) return true;

  const automation = await claimDueAutomation();
  if (!automation) return false;
  let didWork = false;
  let nextCheckAt = new Date(Date.now() + pollIntervalMs());
  let errorMessage: string | null = null;
  try {
    didWork = await monitorClaimedAutomation(automation);
  } catch (error) {
    errorMessage = sanitizeAutomationError(error);
    nextCheckAt = new Date(Date.now() + retryIntervalMs());
    console.warn(`[autopilot] monitor ${automation.id} failed: ${errorMessage}`);
  } finally {
    await prisma.streamAutomation.update({
      where: { id: automation.id },
      data: {
        lastCheckedAt: new Date(),
        nextCheckAt,
        lastError: errorMessage,
        lockedAt: null,
        lockedBy: null,
      },
    });
  }
  return didWork;
}
