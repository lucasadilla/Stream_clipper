import { prisma } from "@/lib/db";
import {
  CREATOR_BETA_PLAN,
  getPricingPlan,
  type PlanEntitlements,
  type PricingPlan,
} from "@/lib/pricing";
import { formatBytes } from "@/lib/storage";
import {
  getBillingAccount,
  hasAppAccess,
  isActiveBillingStatus,
  serializeBillingAccount,
  type BillingAccountSummary,
} from "@/services/billingService";
import { getAccountStoredMediaBytes } from "@/services/retentionService";

export interface MonthlyUsage {
  periodStart: string;
  periodEnd: string;
  streamStarts: number;
  videoUploads: number;
  processedSeconds: number;
  renderedExports: number;
  aiRequests: number;
  storedMediaBytes: number;
}

export interface UsageSnapshot {
  billingAccount: BillingAccountSummary | null;
  plan: PricingPlan | null;
  entitlements: PlanEntitlements | null;
  usage: MonthlyUsage;
  nearLimit: boolean;
}

export interface UsageGateResult {
  allowed: boolean;
  message?: string;
  status?: number;
  snapshot: UsageSnapshot;
}

function monthWindow(now = new Date()) {
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { periodStart, periodEnd };
}

function emptyUsage(periodStart: Date, periodEnd: Date): MonthlyUsage {
  return {
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    streamStarts: 0,
    videoUploads: 0,
    processedSeconds: 0,
    renderedExports: 0,
    aiRequests: 0,
    storedMediaBytes: 0,
  };
}

function billingRequiredSnapshot(periodStart: Date, periodEnd: Date): UsageSnapshot {
  return {
    billingAccount: null,
    plan: null,
    entitlements: null,
    usage: emptyUsage(periodStart, periodEnd),
    nearLimit: false,
  };
}

function unlimitedEntitlements(): PlanEntitlements {
  return {
    plan: "studio",
    processingHoursLimit: null,
    exportsLimit: null,
    storageRetentionDays: null,
    storageLimitBytes: null,
    maxResolution: "custom",
    watermarkEnabled: false,
    priorityQueue: true,
    seatLimit: null,
    streamStartsLimit: null,
    uploadsLimit: null,
    maxSourceDurationSeconds: null,
    maxClipDurationSeconds: null,
  };
}

function isNearLimit(
  usage: MonthlyUsage,
  entitlements: PlanEntitlements | null
): boolean {
  if (!entitlements) return false;
  const hoursLimit = entitlements.processingHoursLimit;
  if (hoursLimit !== null && usage.processedSeconds / 3600 >= hoursLimit * 0.8) {
    return true;
  }
  const exportsLimit = entitlements.exportsLimit;
  if (exportsLimit !== null && usage.renderedExports >= exportsLimit * 0.8) {
    return true;
  }
  const storageLimit = entitlements.storageLimitBytes;
  if (
    storageLimit !== null &&
    usage.storedMediaBytes >= storageLimit * 0.8
  ) {
    return true;
  }
  return false;
}

export async function getUsageSnapshot(
  billingAccountId: string | null | undefined
): Promise<UsageSnapshot> {
  const { periodStart, periodEnd } = monthWindow();
  const account = await getBillingAccount(billingAccountId);
  if (!account || !hasAppAccess(account)) {
    return billingRequiredSnapshot(periodStart, periodEnd);
  }

  const betaOnly = account.betaAccess && !isActiveBillingStatus(account.status);
  const plan = betaOnly ? CREATOR_BETA_PLAN : getPricingPlan(account.plan);
  const entitlements = account.unlimitedAccess
    ? unlimitedEntitlements()
    : plan.entitlements;

  const [sessions, sourceMedia, clipExports, platformExports, transcriptChunks, eventWindows, storedMediaBytes] =
    await Promise.all([
      prisma.streamSession.findMany({
        where: {
          billingAccountId: account.id,
          createdAt: { gte: periodStart, lt: periodEnd },
        },
        select: {
          id: true,
          liveRecording: { select: { recordedSeconds: true } },
        },
      }),
      prisma.sourceMedia.findMany({
        where: {
          streamSession: { billingAccountId: account.id },
          createdAt: { gte: periodStart, lt: periodEnd },
        },
        select: { sizeBytes: true, durationSeconds: true },
      }),
      prisma.renderJob.count({
        where: {
          streamSession: { billingAccountId: account.id },
          createdAt: { gte: periodStart, lt: periodEnd },
          status: "completed",
        },
      }),
      prisma.platformExport.count({
        where: {
          streamSession: { billingAccountId: account.id },
          createdAt: { gte: periodStart, lt: periodEnd },
          status: "completed",
        },
      }),
      prisma.transcriptChunk.count({
        where: {
          streamSession: { billingAccountId: account.id },
          createdAt: { gte: periodStart, lt: periodEnd },
        },
      }),
      prisma.eventWindow.count({
        where: {
          streamSession: { billingAccountId: account.id },
          createdAt: { gte: periodStart, lt: periodEnd },
        },
      }),
      getAccountStoredMediaBytes(account.id),
    ]);

  const sessionSeconds = sessions.reduce((total, session) => {
    const liveSeconds = session.liveRecording?.recordedSeconds ?? 0;
    return total + Math.max(liveSeconds, 0);
  }, 0);

  const mediaSeconds = sourceMedia.reduce(
    (total, media) => total + Math.max(media.durationSeconds ?? 0, 0),
    0
  );

  const usage: MonthlyUsage = {
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    streamStarts: sessions.length,
    videoUploads: sessions.length,
    processedSeconds: Math.max(sessionSeconds, mediaSeconds),
    renderedExports: clipExports + platformExports,
    aiRequests: transcriptChunks + eventWindows,
    storedMediaBytes,
  };

  return {
    billingAccount: serializeBillingAccount(account),
    plan,
    entitlements,
    usage,
    nearLimit: !account.unlimitedAccess && isNearLimit(usage, entitlements),
  };
}

function billingRequiredGate(snapshot: UsageSnapshot): UsageGateResult {
  return {
    allowed: false,
    status: 402,
    message: "Creator Beta access is required right now. Enter your access code to unlock beta features.",
    snapshot,
  };
}

export async function canCreateStreamSession(
  billingAccountId: string | null | undefined
): Promise<UsageGateResult> {
  const snapshot = await getUsageSnapshot(billingAccountId);
  if (!snapshot.plan || !snapshot.entitlements) return billingRequiredGate(snapshot);

  const limit = snapshot.entitlements.uploadsLimit ?? snapshot.entitlements.streamStartsLimit;
  if (limit !== null && snapshot.usage.videoUploads >= limit) {
    return {
      allowed: false,
      status: 402,
      message: `Creator Beta includes ${limit} video uploads per month. Your limit resets next month.`,
      snapshot,
    };
  }

  const storageGate = checkStorageLimit(snapshot);
  if (!storageGate.allowed) return storageGate;

  return { allowed: true, snapshot };
}

function checkStorageLimit(snapshot: UsageSnapshot): UsageGateResult {
  const storageLimit = snapshot.entitlements?.storageLimitBytes ?? null;
  if (
    storageLimit !== null &&
    snapshot.usage.storedMediaBytes >= storageLimit
  ) {
    return {
      allowed: false,
      status: 402,
      message: `Storage full (${formatBytes(snapshot.usage.storedMediaBytes)} / ${formatBytes(storageLimit)}). Delete old sessions or upgrade your plan.`,
      snapshot,
    };
  }
  return { allowed: true, snapshot };
}

export async function canProcessMoreSeconds(
  billingAccountId: string | null | undefined,
  nextSeconds = 0
): Promise<UsageGateResult> {
  const snapshot = await getUsageSnapshot(billingAccountId);
  if (!snapshot.plan || !snapshot.entitlements) return billingRequiredGate(snapshot);

  const storageGate = checkStorageLimit(snapshot);
  if (!storageGate.allowed) return storageGate;

  const limit = snapshot.entitlements.processingHoursLimit;
  if (limit !== null) {
    const usedHours = (snapshot.usage.processedSeconds + nextSeconds) / 3600;
    if (usedHours >= limit) {
      return {
        allowed: false,
        status: 402,
        message: `Your ${snapshot.plan.name} plan includes ${limit} processing hours per month. Upgrade your plan to keep transcribing.`,
        snapshot,
      };
    }
  }
  return { allowed: true, snapshot };
}

export async function canRenderExport(
  billingAccountId: string | null | undefined,
  nextExports = 1,
  clipDurationSeconds?: number
): Promise<UsageGateResult> {
  const snapshot = await getUsageSnapshot(billingAccountId);
  if (!snapshot.plan || !snapshot.entitlements) return billingRequiredGate(snapshot);

  const maxClipDuration = snapshot.entitlements.maxClipDurationSeconds;
  if (
    maxClipDuration !== null &&
    typeof clipDurationSeconds === "number" &&
    clipDurationSeconds > maxClipDuration
  ) {
    return {
      allowed: false,
      status: 400,
      message: `Creator Beta rendered clips can be up to ${maxClipDuration} seconds. Shorten this clip before rendering.`,
      snapshot,
    };
  }

  const limit = snapshot.entitlements.exportsLimit;
  if (
    limit !== null &&
    snapshot.usage.renderedExports + Math.max(1, nextExports) > limit
  ) {
    return {
      allowed: false,
      status: 402,
      message: `Your ${snapshot.plan.name} plan includes ${limit} exports per month. Upgrade your plan to render more clips.`,
      snapshot,
    };
  }
  return { allowed: true, snapshot };
}

export async function canUseSourceDuration(
  billingAccountId: string | null | undefined,
  durationSeconds: number
): Promise<UsageGateResult> {
  const snapshot = await getUsageSnapshot(billingAccountId);
  if (!snapshot.plan || !snapshot.entitlements) return billingRequiredGate(snapshot);
  const limit = snapshot.entitlements.maxSourceDurationSeconds;
  if (limit !== null && durationSeconds > limit) {
    return {
      allowed: false,
      status: 400,
      message: "Creator Beta source videos can be up to 3 hours long.",
      snapshot,
    };
  }
  return { allowed: true, snapshot };
}
