import path from "path";
import { spawn } from "child_process";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { toJsonValue } from "@/lib/utils";
import { extractSoloTimelineFrame } from "@/lib/ffmpeg";
import {
  ensureDir,
  getFramesDir,
  resolveStoragePath,
  toRelativeStoragePath,
} from "@/lib/storage";
import { ensureClipSourceForRender } from "@/services/clipSourceService";
import { buildFaceTracks } from "@/lib/faceTracking";
import { normalizeRect } from "@/lib/normalizedRect";
import {
  FACE_ANALYSIS_CONFIG,
  candidateFromTrack,
  classifySourceFromTracks,
  computeTrackMetrics,
  recommendVerticalLayout,
  scoreEmbeddedFacecam,
  scoreSpeakingSubject,
  type FaceDetection,
  type FaceTrack,
  type FacecamAnalysisResult,
  type FacecamCandidate,
} from "@/lib/verticalLayout";

const FACE_ANALYSIS_WORKER_ID = `face-worker-${process.pid}`;

/** Result JSON stored on the job row (adds source info to the shared shape). */
export interface StoredFaceAnalysisResult extends FacecamAnalysisResult {
  sourceWidth: number;
  sourceHeight: number;
  /** Representative frame for UI overlays (relative storage path). */
  frameStoragePath?: string;
  startSeconds: number;
  endSeconds: number;
}

function analysisTimeoutMs(): number {
  const parsed = Number.parseInt(
    process.env.FACECAM_ANALYSIS_TIMEOUT_MS ?? "",
    10
  );
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 4 * 60 * 1000;
}

function pythonExecutable(): string {
  const configured = process.env.FACECAM_PYTHON?.trim();
  if (configured) return configured;
  return process.platform === "win32" ? "python" : "python3";
}

function workerScriptPath(): string {
  return path.resolve(process.cwd(), "workers", "facecam", "analyze.py");
}

interface WorkerPayload {
  videoPath: string;
  startSeconds: number;
  endSeconds: number;
  sampleFps: number;
  analysisWidth: number;
  minConfidence: number;
  maxFrames: number;
}

interface WorkerResult {
  ok: boolean;
  error?: string;
  sourceWidth: number;
  sourceHeight: number;
  sampleFps: number;
  sampledFrames: number;
  detections: FaceDetection[];
  modelName: string;
  modelVersion: string;
}

/**
 * Run the Python face-detection worker. JSON goes in on stdin, structured
 * detections come back on stdout; "PROGRESS n" lines on stderr feed the job
 * progress column. The child is killed after a hard timeout.
 */
function runFaceWorker(
  payload: WorkerPayload,
  onProgress?: (percent: number) => void
): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(pythonExecutable(), [workerScriptPath()], {
      shell: false,
      windowsHide: true,
    });

    let stdout = "";
    let stderrTail = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill();
      reject(new Error("Face analysis timed out"));
    }, analysisTimeoutMs());

    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderrTail = (stderrTail + text).slice(-4000);
      for (const line of text.split(/\r?\n/)) {
        const match = /^PROGRESS\s+(\d+)/.exec(line.trim());
        if (match) onProgress?.(Number.parseInt(match[1]!, 10));
      }
    });
    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(
          new Error(
            "Python is not available for face analysis. Install Python 3 and " +
              "the packages in workers/facecam/requirements.txt, or set " +
              "FACECAM_PYTHON to the interpreter path."
          )
        );
        return;
      }
      reject(err);
    });
    proc.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        const parsed = JSON.parse(stdout) as WorkerResult;
        if (!parsed.ok) {
          reject(new Error(parsed.error || "Face analysis worker failed"));
          return;
        }
        resolve(parsed);
      } catch {
        reject(
          new Error(
            `Face analysis worker exited with code ${code}. ${
              stderrTail ? "Details: " + stderrTail.slice(-500) : ""
            }`.trim()
          )
        );
      }
    });

    proc.stdin.write(JSON.stringify(payload));
    proc.stdin.end();
  });
}

// ---------------------------------------------------------------------------
// Job lifecycle
// ---------------------------------------------------------------------------

const RANGE_TOLERANCE_SECONDS = 0.75;

/**
 * Start (or reuse) a face analysis for a clip range. Completed results for the
 * same range are reused, and an already queued/processing job for the range is
 * returned instead of enqueuing a duplicate.
 */
export async function requestFaceAnalysis(options: {
  streamSessionId: string;
  clipSuggestionId?: string;
  startSeconds: number;
  endSeconds: number;
  sampleFps?: number;
  force?: boolean;
}): Promise<{ jobId: string; status: string }> {
  const start = Math.max(0, options.startSeconds);
  const end = Math.max(start + 0.5, options.endSeconds);
  const sampleFps = Math.min(8, Math.max(1, options.sampleFps ?? 4));

  if (!options.force) {
    const existing = await prisma.faceAnalysisJob.findFirst({
      where: {
        streamSessionId: options.streamSessionId,
        startSeconds: {
          gte: start - RANGE_TOLERANCE_SECONDS,
          lte: start + RANGE_TOLERANCE_SECONDS,
        },
        endSeconds: {
          gte: end - RANGE_TOLERANCE_SECONDS,
          lte: end + RANGE_TOLERANCE_SECONDS,
        },
        status: {
          in: [
            "queued",
            "extracting_frames",
            "detecting_faces",
            "tracking_faces",
            "classifying_layout",
            "completed",
          ],
        },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true },
    });
    if (existing) return { jobId: existing.id, status: existing.status };
  }

  const job = await prisma.faceAnalysisJob.create({
    data: {
      streamSessionId: options.streamSessionId,
      clipSuggestionId: options.clipSuggestionId,
      scope: "clip",
      status: "queued",
      startSeconds: start,
      endSeconds: end,
      sampleFps,
    },
  });

  void import("@/services/workerService")
    .then(({ runWorkerTick }) => runWorkerTick())
    .catch(() => {});

  return { jobId: job.id, status: "queued" };
}

export async function getFaceAnalysisJob(jobId: string) {
  return prisma.faceAnalysisJob.findUnique({ where: { id: jobId } });
}

export function parseStoredFaceAnalysisResult(
  value: unknown
): StoredFaceAnalysisResult | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as StoredFaceAnalysisResult;
  if (!raw.classification || !Array.isArray(raw.tracks)) return null;
  return raw;
}

async function updateAnalysisProgress(
  jobId: string,
  status: string,
  progress: number
) {
  await prisma.faceAnalysisJob.update({
    where: { id: jobId },
    data: {
      status,
      progress: Math.min(100, Math.max(0, Math.round(progress))),
    },
  });
}

export async function failFaceAnalysisJob(jobId: string, message: string) {
  await prisma.faceAnalysisJob.update({
    where: { id: jobId },
    data: {
      status: "failed",
      errorMessage: message.slice(0, 2000),
      completedAt: new Date(),
      lockedAt: null,
      lockedBy: null,
    },
  });
}

/**
 * Run the full analysis pipeline for a claimed job: resolve the local source,
 * run the Python detector, build tracks, classify, score candidates and store
 * the structured result.
 */
export async function executeFaceAnalysisJob(jobId: string): Promise<void> {
  const job = await prisma.faceAnalysisJob.findUnique({ where: { id: jobId } });
  if (!job) throw new Error("Face analysis job not found");

  await updateAnalysisProgress(jobId, "extracting_frames", 5);

  // Resolve a local, playable file covering the requested range. renderStart
  // is the requested range start expressed in that file's own timeline.
  const clipSource = await ensureClipSourceForRender(
    job.streamSessionId,
    job.startSeconds,
    job.endSeconds
  );
  const sourceMedia = await prisma.sourceMedia.findUnique({
    where: { id: clipSource.sourceMediaId },
  });
  if (!sourceMedia) throw new Error("Source media not found for analysis");
  const inputPath = resolveStoragePath(sourceMedia.filePath);

  await prisma.faceAnalysisJob.update({
    where: { id: jobId },
    data: { sourceMediaId: sourceMedia.id },
  });

  await updateAnalysisProgress(jobId, "detecting_faces", 10);

  const worker = await runFaceWorker(
    {
      videoPath: inputPath,
      startSeconds: clipSource.renderStart,
      endSeconds: clipSource.renderEnd,
      sampleFps: job.sampleFps,
      analysisWidth: Number.parseInt(
        process.env.FACECAM_ANALYSIS_WIDTH ?? "640",
        10
      ) || 640,
      minConfidence: FACE_ANALYSIS_CONFIG.minConfidence,
      maxFrames: 600,
    },
    (percent) => {
      // Detection covers 10..70% of overall job progress.
      void updateAnalysisProgress(
        jobId,
        "detecting_faces",
        10 + (percent * 60) / 100
      ).catch(() => {});
    }
  );

  await updateAnalysisProgress(jobId, "tracking_faces", 72);

  // Shift detection timestamps from file time back onto the session timeline
  // so stored tracks line up with clip start/end times.
  const timeOffset = job.startSeconds - clipSource.renderStart;
  const detections: FaceDetection[] = worker.detections.flatMap((d) => {
    const rect = normalizeRect(d.rect);
    if (!rect) return [];
    const detection: FaceDetection = {
      timestampSeconds: d.timestampSeconds + timeOffset,
      rect,
      confidence: d.confidence,
    };
    if (
      typeof d.mouthOpenRatio === "number" &&
      Number.isFinite(d.mouthOpenRatio)
    ) {
      detection.mouthOpenRatio = d.mouthOpenRatio;
    }
    return [detection];
  });

  const tracks = buildFaceTracks(detections);
  const sampledFrames = Math.max(1, worker.sampledFrames);

  await updateAnalysisProgress(jobId, "classifying_layout", 82);

  const metricsById = new Map(
    tracks.map((track) => [track.id, computeTrackMetrics(track, sampledFrames)])
  );
  const { classification, confidence } = classifySourceFromTracks(
    tracks,
    metricsById
  );

  const sourceWidth = sourceMedia.width ?? worker.sourceWidth;
  const sourceHeight = sourceMedia.height ?? worker.sourceHeight;

  // Embedded facecams: score by stability. Talking-head / multi-face: prefer
  // the face that looks like it is speaking so Follow speaker works out of the box.
  const preferSpeaker =
    classification === "moving_subject" || classification === "multiple_faces";

  const scoredTracks = tracks
    .map((track) => ({ track, metrics: metricsById.get(track.id)! }))
    .filter(
      ({ metrics }) =>
        metrics.persistence >= 0.15 && metrics.averageConfidence >= 0.45
    )
    .sort((a, b) =>
      preferSpeaker
        ? scoreSpeakingSubject(b.metrics) - scoreSpeakingSubject(a.metrics)
        : scoreEmbeddedFacecam(b.metrics) - scoreEmbeddedFacecam(a.metrics)
    );

  const candidates: FacecamCandidate[] = scoredTracks
    .slice(0, 4)
    .map(({ track, metrics }) =>
      candidateFromTrack(track, metrics, sourceWidth, sourceHeight)
    );

  const primaryCandidate = candidates[0];
  const alternativeCandidates = candidates.slice(1);

  const warnings: string[] = [];
  if (classification === "no_face") {
    warnings.push(
      "No reliable facecam was detected. You can use Center Crop or manually select a region."
    );
  }
  if (classification === "multiple_faces") {
    warnings.push(
      "Multiple faces were detected. Select the person or facecam you want to feature."
    );
  }
  if (worker.modelName === "opencv-haar") {
    warnings.push(
      "Face detection used a basic fallback model. Install MediaPipe for better results."
    );
  }

  const recommendation = recommendVerticalLayout(classification, primaryCandidate);

  // Representative frame at the range midpoint for the manual-adjust UI.
  let frameStoragePath: string | undefined;
  try {
    const framesDir = getFramesDir(job.streamSessionId);
    await ensureDir(framesDir);
    const framePath = path.join(framesDir, `facecam_${jobId}.jpg`);
    const midpoint =
      clipSource.renderStart +
      (clipSource.renderEnd - clipSource.renderStart) / 2;
    await extractSoloTimelineFrame(inputPath, framePath, midpoint, 960, 3);
    frameStoragePath = toRelativeStoragePath(framePath);
  } catch {
    // A missing preview frame must never fail the analysis.
  }

  // Slim the stored tracks: candidates keep full point data (needed for
  // subject-aware crop planning); other tracks store a sampled subset.
  const candidateTrackIds = new Set(candidates.map((c) => c.trackId));
  const storedTracks: FaceTrack[] = tracks.map((track) => {
    if (candidateTrackIds.has(track.id) || track.points.length <= 40) {
      return track;
    }
    const stride = Math.ceil(track.points.length / 40);
    return {
      ...track,
      points: track.points.filter((_, i) => i % stride === 0),
    };
  });

  const result: StoredFaceAnalysisResult = {
    id: jobId,
    sourceMediaId: sourceMedia.id,
    clipId: job.clipSuggestionId ?? undefined,
    classification,
    confidence,
    sampleFps: worker.sampleFps,
    primaryCandidate,
    alternativeCandidates,
    tracks: storedTracks,
    recommendation,
    warnings,
    modelName: worker.modelName,
    modelVersion: worker.modelVersion,
    createdAt: new Date().toISOString(),
    sourceWidth,
    sourceHeight,
    frameStoragePath,
    startSeconds: job.startSeconds,
    endSeconds: job.endSeconds,
  };

  await prisma.faceAnalysisJob.update({
    where: { id: jobId },
    data: {
      status: "completed",
      progress: 100,
      classification,
      confidence,
      resultJson: toJsonValue(result) as Prisma.InputJsonValue,
      errorMessage: null,
      completedAt: new Date(),
      lockedAt: null,
      lockedBy: null,
    },
  });
}

// ---------------------------------------------------------------------------
// Worker-queue integration (mirrors the RenderJob claim/reclaim pattern)
// ---------------------------------------------------------------------------

const ANALYSIS_ACTIVE_STATUSES = [
  "extracting_frames",
  "detecting_faces",
  "tracking_faces",
  "classifying_layout",
];

export async function reclaimStaleFaceAnalysisJobs(): Promise<number> {
  const staleMs = Math.max(
    60_000,
    Number.parseInt(process.env.WORKER_STALE_MS || "600000", 10) || 600_000
  );
  const cutoff = new Date(Date.now() - staleMs);
  const stale = await prisma.faceAnalysisJob.findMany({
    where: {
      status: { in: ANALYSIS_ACTIVE_STATUSES },
      OR: [{ lockedAt: { lt: cutoff } }, { lockedAt: null, updatedAt: { lt: cutoff } }],
    },
    select: { id: true, attempts: true, maxAttempts: true },
    take: 10,
  });

  let reclaimed = 0;
  for (const job of stale) {
    const nextStatus = job.attempts >= job.maxAttempts ? "failed" : "queued";
    await prisma.faceAnalysisJob.update({
      where: { id: job.id },
      data: {
        status: nextStatus,
        lockedAt: null,
        lockedBy: null,
        errorMessage:
          nextStatus === "failed"
            ? "Face analysis timed out or the worker restarted too many times"
            : null,
      },
    });
    reclaimed += 1;
  }
  return reclaimed;
}

async function claimNextFaceAnalysisJob(): Promise<string | null> {
  const candidates = await prisma.faceAnalysisJob.findMany({
    where: { status: "queued" },
    orderBy: { createdAt: "asc" },
    take: 4,
    select: { id: true, attempts: true, maxAttempts: true },
  });

  for (const candidate of candidates) {
    if (candidate.attempts >= candidate.maxAttempts) {
      await failFaceAnalysisJob(candidate.id, "Exceeded maximum analysis attempts");
      continue;
    }
    const updated = await prisma.faceAnalysisJob.updateMany({
      where: { id: candidate.id, status: "queued" },
      data: {
        status: "extracting_frames",
        lockedAt: new Date(),
        lockedBy: FACE_ANALYSIS_WORKER_ID,
        startedAt: new Date(),
        attempts: { increment: 1 },
        progress: 2,
        errorMessage: null,
      },
    });
    if (updated.count === 1) return candidate.id;
  }
  return null;
}

/** Permanent input errors must not be retried (invalid media, missing python). */
function isPermanentAnalysisError(message: string): boolean {
  return /Could not open video|Python is not available|Source media not found|Session not found/i.test(
    message
  );
}

export async function processOneFaceAnalysisJob(): Promise<boolean> {
  const jobId = await claimNextFaceAnalysisJob();
  if (!jobId) return false;

  try {
    await executeFaceAnalysisJob(jobId);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Face analysis failed";
    const fresh = await prisma.faceAnalysisJob.findUnique({
      where: { id: jobId },
      select: { attempts: true, maxAttempts: true },
    });
    if (!fresh) return true;

    if (!isPermanentAnalysisError(message) && fresh.attempts < fresh.maxAttempts) {
      await prisma.faceAnalysisJob.update({
        where: { id: jobId },
        data: {
          status: "queued",
          lockedAt: null,
          lockedBy: null,
          errorMessage: message.slice(0, 2000),
          progress: 0,
        },
      });
    } else {
      await failFaceAnalysisJob(jobId, message);
    }
  }
  return true;
}
