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
      const result = await syncTranscription(sessionId, {
        budgetSeconds: 120,
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
    const reclaimed =
      staleRenders + stalePlatformExports + staleSocial + staleFaceAnalyses;
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
let pollerHandle: ReturnType<typeof setInterval> | null = null;

export function startWorkerPoller(): void {
  if (pollerStarted || !isWorkerEnabled()) return;
  pollerStarted = true;
  const pollMs = Math.max(
    2000,
    Number.parseInt(process.env.WORKER_POLL_MS || "2000", 10) || 2000
  );
  console.info(`[worker] starting poller every ${pollMs}ms (${WORKER_ID})`);
  void runWorkerTick().catch((err) =>
    console.error("[worker] initial tick failed:", err)
  );
  pollerHandle = setInterval(() => {
    void runWorkerTick().catch((err) =>
      console.error("[worker] tick failed:", err)
    );
  }, pollMs);
  // Do not keep the process alive solely for the poller in some runtimes.
  if (typeof pollerHandle.unref === "function") {
    pollerHandle.unref();
  }
}

export function stopWorkerPoller(): void {
  if (pollerHandle) {
    clearInterval(pollerHandle);
    pollerHandle = null;
  }
  pollerStarted = false;
}
