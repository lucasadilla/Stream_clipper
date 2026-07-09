import { prisma } from "@/lib/db";
import {
  getPricingPlan,
  type PlanEntitlements,
  type PricingPlan,
} from "@/lib/pricing";
import {
  getBillingAccount,
  hasAppAccess,
  serializeBillingAccount,
  type BillingAccountSummary,
} from "@/services/billingService";

export interface MonthlyUsage {
  periodStart: string;
  periodEnd: string;
  streamStarts: number;
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
    processedSeconds: 0,
    renderedExports: 0,
    aiRequests: 0,
    storedMediaBytes: 0,
  };
}

function numberFromBigInt(value: bigint | number | null | undefined): number {
  if (typeof value === "bigint") return Number(value);
  return Number(value ?? 0);
}

function withOverageHours(limit: number | null): number | null {
  if (limit === null) return null;
  const overage = Number(process.env.STREAM_CLIPPER_OVERAGE_PROCESSING_HOURS ?? 0);
  return limit + (Number.isFinite(overage) && overage > 0 ? overage : 0);
}

function withOverageExports(limit: number | null): number | null {
  if (limit === null) return null;
  const overage = Number(process.env.STREAM_CLIPPER_OVERAGE_EXPORTS ?? 0);
  return limit + (Number.isFinite(overage) && overage > 0 ? overage : 0);
}

function billingRequiredSnapshot(periodStart: Date, periodEnd: Date): UsageSnapshot {
  return {
    billingAccount: null,
    plan: null,
    entitlements: null,
    usage: emptyUsage(periodStart, periodEnd),
  };
}

function unlimitedEntitlements(): PlanEntitlements {
  return {
    plan: "studio",
    processingHoursLimit: null,
    exportsLimit: null,
    storageRetentionDays: null,
    maxResolution: "custom",
    watermarkEnabled: false,
    priorityQueue: true,
    seatLimit: null,
    streamStartsLimit: null,
  };
}

export async function getUsageSnapshot(
  billingAccountId: string | null | undefined
): Promise<UsageSnapshot> {
  const { periodStart, periodEnd } = monthWindow();
  const account = await getBillingAccount(billingAccountId);
  if (!account || !hasAppAccess(account)) {
    return billingRequiredSnapshot(periodStart, periodEnd);
  }

  const plan = getPricingPlan(account.plan);
  const entitlements = account.unlimitedAccess
    ? unlimitedEntitlements()
    : {
        ...plan.entitlements,
        processingHoursLimit: withOverageHours(plan.entitlements.processingHoursLimit),
        exportsLimit: withOverageExports(plan.entitlements.exportsLimit),
      };

  const [sessions, sourceMedia, renderedExports, transcriptChunks, eventWindows] =
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
    ]);

  const sessionSeconds = sessions.reduce((total, session) => {
    const liveSeconds = session.liveRecording?.recordedSeconds ?? 0;
    return total + Math.max(liveSeconds, 0);
  }, 0);

  const mediaSeconds = sourceMedia.reduce(
    (total, media) => total + Math.max(media.durationSeconds ?? 0, 0),
    0
  );

  const storedMediaBytes = sourceMedia.reduce(
    (total, media) => total + numberFromBigInt(media.sizeBytes),
    0
  );

  return {
    billingAccount: serializeBillingAccount(account),
    plan,
    entitlements,
    usage: {
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      streamStarts: sessions.length,
      processedSeconds: Math.max(sessionSeconds, mediaSeconds),
      renderedExports,
      aiRequests: transcriptChunks + eventWindows,
      storedMediaBytes,
    },
  };
}

function billingRequiredGate(snapshot: UsageSnapshot): UsageGateResult {
  return {
    allowed: false,
    status: 402,
    message: "Choose a paid plan to start clipping. Stream Clipper does not offer a free tier.",
    snapshot,
  };
}

export async function canCreateStreamSession(
  billingAccountId: string | null | undefined
): Promise<UsageGateResult> {
  const snapshot = await getUsageSnapshot(billingAccountId);
  if (!snapshot.plan || !snapshot.entitlements) return billingRequiredGate(snapshot);

  const limit = snapshot.entitlements.streamStartsLimit;
  if (limit !== null && snapshot.usage.streamStarts >= limit) {
    return {
      allowed: false,
      status: 402,
      message: `Your ${snapshot.plan.name} plan includes ${limit} stream per month. Upgrade for more processing time.`,
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

  const limit = snapshot.entitlements.processingHoursLimit;
  if (limit !== null) {
    const usedHours = (snapshot.usage.processedSeconds + nextSeconds) / 3600;
    if (usedHours >= limit) {
      return {
        allowed: false,
        status: 402,
        message: `Your ${snapshot.plan.name} plan includes ${limit} processing hours per month. Add an overage pack or upgrade to keep transcribing.`,
        snapshot,
      };
    }
  }
  return { allowed: true, snapshot };
}

export async function canRenderExport(
  billingAccountId: string | null | undefined
): Promise<UsageGateResult> {
  const snapshot = await getUsageSnapshot(billingAccountId);
  if (!snapshot.plan || !snapshot.entitlements) return billingRequiredGate(snapshot);

  const limit = snapshot.entitlements.exportsLimit;
  if (limit !== null && snapshot.usage.renderedExports >= limit) {
    return {
      allowed: false,
      status: 402,
      message: `Your ${snapshot.plan.name} plan includes ${limit} exports per month. Add an export pack or upgrade to render more clips.`,
      snapshot,
    };
  }
  return { allowed: true, snapshot };
}
