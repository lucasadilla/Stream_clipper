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
import { acquireSourceMedia } from "@/services/liveRecordingService";

const WORKER_ID = `worker-${process.pid}-${randomUUID().slice(0, 8)}`;

let tickInFlight = false;
let sourceRecoveryInFlight = false;
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
  return process.env.NODE_ENV === "production";
}

function isSourceRecoveryEnabled(): boolean {
  const raw = process.env.SOURCE_RECOVERY_ENABLED?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") return false;
  if (raw === "1" || raw === "true" || raw === "on") return true;
  return process.env.NODE_ENV === "production";
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
      if (result.error || (result.skipped && result.reason && result.reason !== "caught_up" && result.reason !== "sync_in_progress")) {
        await prisma.streamSession.update({
          where: { id: sessionId },
          data: {
            lastTranscriptionError: result.error
              ? result.error.slice(0, 2000)
              : result.reason
                ? `skipped:${result.reason}`
                : null,
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

async function recoverOneStalledSource(): Promise<boolean> {
  const cutoff = new Date(Date.now() - 30_000);
  const candidates = await prisma.streamSession.findMany({
    where: {
      liveRecording: {
        is: {
          status: { in: ["recording", "failed", "stopped", "completed"] },
          recordedSeconds: { lt: 3 },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 8,
    select: {
      id: true,
      liveRecording: {
        select: { startedAt: true, lastSyncedAt: true },
      },
      sourceMedia: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { durationSeconds: true },
      },
    },
  });

  for (const candidate of candidates) {
    if ((candidate.sourceMedia[0]?.durationSeconds ?? 0) >= 3) continue;
    const attemptedAt =
      candidate.liveRecording?.lastSyncedAt ??
      candidate.liveRecording?.startedAt;
    if (attemptedAt && attemptedAt > cutoff) continue;

    const claimed = await prisma.liveRecordingState.updateMany({
      where: {
        streamSessionId: candidate.id,
        OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lte: cutoff } }],
      },
      data: { lastSyncedAt: new Date() },
    });
    if (claimed.count !== 1) continue;

    try {
      console.info(`[worker] recovering stalled source for ${candidate.id}`);
      const result = await acquireSourceMedia(candidate.id);
      const duration = result.sourceMedia?.durationSeconds ?? 0;
      console.info(
        `[worker] source recovery finished for ${candidate.id} (${Math.round(duration)}s)`
      );
      await prisma.streamSession.update({
        where: { id: candidate.id },
        data: {
          lastTranscriptionError:
            duration >= 3 ? null : "Source capture is still starting",
        },
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Source acquisition failed";
      console.error(
        `[worker] source recovery failed for ${candidate.id}: ${message}`
      );
      await prisma.streamSession.update({
        where: { id: candidate.id },
        data: {
          lastTranscriptionError: `Source acquisition: ${message}`.slice(
            0,
            2000
          ),
        },
      });
    }
    return true;
  }

  return false;
}

function queueStalledSourceRecovery(): number {
  if (!isSourceRecoveryEnabled() || sourceRecoveryInFlight) return 0;
  sourceRecoveryInFlight = true;
  void recoverOneStalledSource()
    .catch((error) => {
      console.error("[worker] source recovery failed:", error);
    })
    .finally(() => {
      sourceRecoveryInFlight = false;
    });
  return 1;
}

export interface WorkerTickResult {
  reclaimed: number;
  sourceRecoveries: number;
  renders: number;
  platformExports: number;
  transcriptions: number;
  retentionDeleted: number;
}

export async function runWorkerTick(): Promise<WorkerTickResult> {
  if (tickInFlight) {
    return {
      reclaimed: 0,
      sourceRecoveries: 0,
      renders: 0,
      platformExports: 0,
      transcriptions: 0,
      retentionDeleted: 0,
    };
  }
  tickInFlight = true;
  try {
    const [staleRenders, stalePlatformExports] = await Promise.all([
      reclaimStaleRenderJobs(),
      reclaimStalePlatformExports(),
    ]);
    const reclaimed = staleRenders + stalePlatformExports;
    const sourceRecoveries = queueStalledSourceRecovery();
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
      sourceRecoveries,
      renders,
      platformExports,
      transcriptions,
      retentionDeleted,
    };
  } finally {
    tickInFlight = false;
  }
}

let pollerStarted = false;
let pollerHandle: ReturnType<typeof setInterval> | null = null;

export function startWorkerPoller(): void {
  if (pollerStarted || !isWorkerEnabled()) return;
  pollerStarted = true;
  const pollMs = Math.max(
    2000,
    Number.parseInt(process.env.WORKER_POLL_MS || "8000", 10) || 8000
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
