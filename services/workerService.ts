import { randomUUID } from "crypto";
import { prisma } from "@/lib/db";
import { formatFfmpegProcessError } from "@/lib/ffmpeg";
import { appendRenderJobLog } from "@/lib/renderJobLogs";
import {
  executeRenderJob,
  failRenderJob,
  parseRenderJobParams,
} from "@/services/renderService";
import {
  claimTranscriptionLock,
  releaseTranscriptionLock,
  listSessionsNeedingTranscription,
} from "@/services/transcriptionLockService";
import { syncTranscription } from "@/services/transcriptionSyncService";
import {
  AGENT_TRANSCRIPTION_BUDGET_SECONDS,
  AGENT_TRANSCRIPTION_CHUNK_SECONDS,
  AGENT_TRANSCRIPTION_PARALLEL,
} from "@/lib/transcriptionConstants";
import { runRetentionCleanup } from "@/services/retentionService";
import {
  claimNextPlatformExport,
  executePlatformExport,
  failPlatformExport,
  reclaimStalePlatformExports,
} from "@/services/platformExportService";
import {
  claimNextSocialPublishJob,
  executeSocialPublishJob,
  failSocialPublishJob,
  reclaimStaleSocialPublishJobs,
} from "@/services/social/socialPublishingService";
import {
  processOneFaceAnalysisJob,
  reclaimStaleFaceAnalysisJobs,
} from "@/services/faceAnalysisService";

const WORKER_ID = `worker-${process.pid}-${randomUUID().slice(0, 8)}`;

let tickInFlight = false;
let pendingNudge = false;
let lastRetentionAt = 0;
let lastStorageReclaimAt = 0;
let lastStaleReclaimAt = 0;

function staleMs(): number {
  return Math.max(
    60_000,
    Number.parseInt(process.env.WORKER_STALE_MS || "600000", 10) || 600_000
  );
}

function retentionTickMs(): number {
  const hours = Math.max(
    1,
    Number.parseInt(process.env.RETENTION_TICK_HOURS || "6", 10) || 6
  );
  return hours * 60 * 60 * 1000;
}

function storageReclaimTickMs(): number {
  const minutes = Math.max(
    1,
    Number.parseInt(process.env.STORAGE_RECLAIM_MINUTES || "2", 10) || 2
  );
  return minutes * 60 * 1000;
}

function staleReclaimTickMs(): number {
  const minutes = Math.max(
    1,
    Number.parseInt(process.env.WORKER_STALE_RECLAIM_MINUTES || "5", 10) || 5
  );
  return minutes * 60 * 1000;
}

async function runFrequentStorageReclaim(): Promise<void> {
  if (Date.now() - lastStorageReclaimAt < storageReclaimTickMs()) return;
  lastStorageReclaimAt = Date.now();
  try {
    const [{ reclaimEphemeralStorage }, { enforceSingleSessionPerAccount }] =
      await Promise.all([
        import("@/services/storageReclaimService"),
        import("@/services/sessionCleanupService"),
      ]);
    await enforceSingleSessionPerAccount();
    await reclaimEphemeralStorage({ pruneSessionSegments: false });
  } catch (err) {
    console.warn("[worker] frequent storage reclaim failed:", err);
  }
}

export function isWorkerEnabled(): boolean {
  const raw = process.env.WORKER_ENABLED?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") return false;
  if (raw === "1" || raw === "true" || raw === "on") return true;
  // On by default in all environments so render jobs don't sit queued in
  // local next-dev (previously only processed when the API awaited a tick).
  return true;
}

export async function reclaimStaleRenderJobs(): Promise<number> {
  const cutoff = new Date(Date.now() - staleMs());
  const stale = await prisma.renderJob.findMany({
    where: {
      status: "processing",
      OR: [{ lockedAt: { lt: cutoff } }, { lockedAt: null, updatedAt: { lt: cutoff } }],
    },
    select: { id: true, attempts: true, maxAttempts: true },
    take: 20,
  });

  let reclaimed = 0;
  for (const job of stale) {
    const nextStatus = job.attempts >= job.maxAttempts ? "failed" : "queued";
    await prisma.renderJob.update({
      where: { id: job.id },
      data: {
        status: nextStatus,
        lockedAt: null,
        lockedBy: null,
        errorMessage:
          nextStatus === "failed"
            ? "Render timed out or worker restarted too many times"
            : null,
      },
    });
    await appendRenderJobLog(
      job.id,
      "reclaimed_after_restart",
      nextStatus === "failed"
        ? "Gave up after stale lock"
        : "Re-queued after stale processing lock",
      nextStatus === "failed" ? "error" : "warn"
    );
    reclaimed += 1;
  }
  return reclaimed;
}

async function claimNextRenderJob(): Promise<string | null> {
  // Optimistic claim: pick oldest queued job and CAS to processing.
  const candidates = await prisma.renderJob.findMany({
    where: { status: "queued" },
    orderBy: { createdAt: "asc" },
    take: 8,
    select: { id: true, attempts: true, maxAttempts: true },
  });

  for (const candidate of candidates) {
    if (candidate.attempts >= candidate.maxAttempts) {
      await failRenderJob(
        candidate.id,
        "Exceeded maximum render attempts"
      );
      continue;
    }

    const updated = await prisma.renderJob.updateMany({
      where: { id: candidate.id, status: "queued" },
      data: {
        status: "processing",
        lockedAt: new Date(),
        lockedBy: WORKER_ID,
        startedAt: new Date(),
        attempts: { increment: 1 },
        progress: 5,
        errorMessage: null,
      },
    });
    if (updated.count === 1) {
      await appendRenderJobLog(
        candidate.id,
        "claimed",
        `Claimed by ${WORKER_ID}`
      );
      return candidate.id;
    }
  }
  return null;
}

async function processOneRenderJob(): Promise<boolean> {
  const jobId = await claimNextRenderJob();
  if (!jobId) return false;

  const job = await prisma.renderJob.findUnique({ where: { id: jobId } });
  if (!job) return false;

  const params = parseRenderJobParams(job.params);
  if (!params) {
    await failRenderJob(jobId, "Render job is missing params");
    return true;
  }

  try {
    await executeRenderJob(jobId, params);
  } catch (error) {
    const message = formatFfmpegProcessError(error);
    const fresh = await prisma.renderJob.findUnique({
      where: { id: jobId },
      select: { attempts: true, maxAttempts: true },
    });
    if (!fresh) return true;

    if (fresh.attempts < fresh.maxAttempts) {
      await appendRenderJobLog(jobId, "retry", message, "warn");
      await prisma.renderJob.update({
        where: { id: jobId },
        data: {
          status: "queued",
          lockedAt: null,
          lockedBy: null,
          errorMessage: message.slice(0, 4000),
          progress: 0,
        },
      });
    } else {
      await failRenderJob(jobId, message);
    }
  }
  return true;
}

async function processOnePlatformExport(): Promise<boolean> {
  const exportId = await claimNextPlatformExport();
  if (!exportId) return false;

  try {
    await executePlatformExport(exportId);
  } catch (error) {
    await failPlatformExport(exportId, error);
  }
  return true;
}

async function processOneSocialPublish(): Promise<boolean> {
  const jobId = await claimNextSocialPublishJob();
  if (!jobId) return false;

  try {
    await executeSocialPublishJob(jobId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Social publish failed";
    await failSocialPublishJob(jobId, message);
  }
  return true;
}

async function processOneTranscription(): Promise<boolean> {
  const sessionIds = await listSessionsNeedingTranscription(6);
  for (const sessionId of sessionIds) {
    const claimed = await claimTranscriptionLock(sessionId, WORKER_ID);
    if (!claimed) continue;
    try {
      const session = await prisma.streamSession.findUnique({
        where: { id: sessionId },
        select: { mode: true, liveStatus: true },
      });
      const agentPriority = session?.mode === "agent";
      const result = await syncTranscription(sessionId, {
        isLive:
          session?.liveStatus === "live" ||
          session?.liveStatus === "upcoming",
        budgetSeconds: agentPriority
          ? AGENT_TRANSCRIPTION_BUDGET_SECONDS
          : 120,
        ...(agentPriority
          ? {
              chunkSeconds: AGENT_TRANSCRIPTION_CHUNK_SECONDS,
              parallel: AGENT_TRANSCRIPTION_PARALLEL,
            }
          : {}),
        heldLockOwner: WORKER_ID,
      });
      if (result.error) {
        await prisma.streamSession.update({
          where: { id: sessionId },
          data: {
            lastTranscriptionError: result.error.slice(0, 2000),
          },
        });
      } else if (!result.skipped) {
        await prisma.streamSession.update({
          where: { id: sessionId },
          data: { lastTranscriptionError: null },
        });
      }
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Transcription failed";
      await prisma.streamSession.update({
        where: { id: sessionId },
        data: { lastTranscriptionError: message.slice(0, 2000) },
      });
      return true;
    } finally {
      await releaseTranscriptionLock(sessionId, WORKER_ID);
    }
  }
  return false;
}

export interface WorkerTickResult {
  reclaimed: number;
  renders: number;
  platformExports: number;
  socialPublishes: number;
  transcriptions: number;
  faceAnalyses: number;
  retentionDeleted: number;
}

export async function runWorkerTick(): Promise<WorkerTickResult> {
  if (tickInFlight) {
    pendingNudge = true;
    return {
      reclaimed: 0,
      renders: 0,
      platformExports: 0,
      socialPublishes: 0,
      transcriptions: 0,
      faceAnalyses: 0,
      retentionDeleted: 0,
    };
  }
  tickInFlight = true;
  try {
    let reclaimed = 0;
    if (Date.now() - lastStaleReclaimAt >= staleReclaimTickMs()) {
      lastStaleReclaimAt = Date.now();
      const [staleRenders, stalePlatformExports, staleSocial, staleFaceAnalyses] =
        await Promise.all([
          reclaimStaleRenderJobs(),
          reclaimStalePlatformExports(),
          reclaimStaleSocialPublishJobs(),
          reclaimStaleFaceAnalysisJobs().catch((err) => {
            console.warn("[worker] face analysis reclaim skipped:", err);
            return 0;
          }),
        ]);
      reclaimed =
        staleRenders + stalePlatformExports + staleSocial + staleFaceAnalyses;
    }

    // Free volume space before any render/transcription attempts to write.
    await runFrequentStorageReclaim();

    let renders = 0;
    // Process up to a few renders per tick so the loop stays responsive.
    for (let i = 0; i < 2; i++) {
      const did = await processOneRenderJob();
      if (!did) break;
      renders += 1;
    }

    let platformExports = 0;
    const didPlatformExport = await processOnePlatformExport();
    if (didPlatformExport) platformExports = 1;

    let socialPublishes = 0;
    const didSocial = await processOneSocialPublish();
    if (didSocial) socialPublishes = 1;

    let faceAnalyses = 0;
    try {
      const didFace = await processOneFaceAnalysisJob();
      if (didFace) faceAnalyses = 1;
    } catch (err) {
      console.error("[worker] face analysis failed:", err);
    }

    let transcriptions = 0;
    const didTx = await processOneTranscription();
    if (didTx) transcriptions = 1;

    let retentionDeleted = 0;
    if (Date.now() - lastRetentionAt >= retentionTickMs()) {
      lastRetentionAt = Date.now();
      try {
        const retention = await runRetentionCleanup({ limit: 10 });
        retentionDeleted = retention.deleted;
      } catch (err) {
        console.error("[worker] retention failed:", err);
      }
    }

    return {
      reclaimed,
      renders,
      platformExports,
      socialPublishes,
      transcriptions,
      faceAnalyses,
      retentionDeleted,
    };
  } finally {
    tickInFlight = false;
    if (pendingNudge) {
      pendingNudge = false;
      void runWorkerTick().catch((err) =>
        console.error("[worker] pending nudge failed:", err)
      );
    }
  }
}

let pollerStarted = false;
let pollerHandle: ReturnType<typeof setTimeout> | null = null;
let idlePollCount = 0;

export function workerTickDidWork(result: WorkerTickResult): boolean {
  return (
    result.reclaimed +
      result.renders +
      result.platformExports +
      result.socialPublishes +
      result.transcriptions +
      result.faceAnalyses +
      result.retentionDeleted >
    0
  );
}

export function nextWorkerPollDelayMs(
  didWork: boolean,
  idleCount: number,
  activeMs: number,
  maxIdleMs: number
): number {
  if (didWork) return activeMs;
  return Math.min(maxIdleMs, activeMs * 2 ** Math.min(4, Math.max(1, idleCount)));
}

export function startWorkerPoller(): void {
  if (pollerStarted || !isWorkerEnabled()) return;
  pollerStarted = true;
  const activePollMs = Math.max(
    2000,
    Number.parseInt(process.env.WORKER_POLL_MS || "3000", 10) || 3000
  );
  const maxIdlePollMs = Math.max(
    activePollMs,
    Number.parseInt(process.env.WORKER_IDLE_POLL_MS || "30000", 10) || 30000
  );
  console.info(
    `[worker] starting adaptive poller ${activePollMs}-${maxIdlePollMs}ms (${WORKER_ID})`
  );

  const schedule = (delayMs: number) => {
    if (!pollerStarted) return;
    pollerHandle = setTimeout(() => void poll(), delayMs);
    if (typeof pollerHandle.unref === "function") pollerHandle.unref();
  };
  const poll = async () => {
    if (!pollerStarted) return;
    let didWork = false;
    try {
      didWork = workerTickDidWork(await runWorkerTick());
    } catch (err) {
      console.error("[worker] tick failed:", err);
    }
    idlePollCount = didWork ? 0 : idlePollCount + 1;
    schedule(
      nextWorkerPollDelayMs(
        didWork,
        idlePollCount,
        activePollMs,
        maxIdlePollMs
      )
    );
  };
  void poll();
}

export function stopWorkerPoller(): void {
  if (pollerHandle) {
    clearTimeout(pollerHandle);
    pollerHandle = null;
  }
  idlePollCount = 0;
  pollerStarted = false;
}
