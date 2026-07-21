import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import { type ChildProcess, spawn, spawnSync } from "child_process";
import { prisma } from "@/lib/db";
import { probeMedia, probeMediaDurationBestEffort } from "@/lib/ffmpeg";
import { toJsonValue } from "@/lib/utils";
import {
  getUploadDir,
  ensureDir,
  toRelativeStoragePath,
  resolveStoragePath,
  findBestSourceFileInDir,
  listSourceCandidateFiles,
} from "@/lib/storage";
import { syncPreviewMp4 } from "@/services/previewVideoService";
import {
  baseYtDlpArgs,
  getYtDlpDeploymentArgs,
  getYtDlpVisitorData,
  resolveYtDlpInvocation,
  formatYtDlpUserError,
  resolveStreamCaptureUrl,
  detectDownloadPlatform,
} from "@/services/youtubeDownloadService";

function liveFormat(): string {
  const configured = Number.parseInt(
    process.env.SOURCE_MAX_HEIGHT?.trim() ?? "",
    10
  );
  const height =
    Number.isFinite(configured) && configured >= 240
      ? configured
      : process.env.NODE_ENV === "production"
        ? 480
        : 1080;
  // Prefer an explicit video+audio merge. Putting `best[ext=mp4]` first often
  // selects YouTube DASH video-only (e.g. f299) and leaves Whisper with no audio.
  return `bestvideo[height<=${height}]+bestaudio/best[height<=${height}]/best`;
}

const MIN_RECORDED_SECONDS = 3;
/** Growing live captures below this size are likely still starting up. */
const MIN_FILE_BYTES_FOR_ESTIMATE = 500_000;
const RECORDING_STARTUP_TIMEOUT_MS = 60_000;
const RECORDING_STARTUP_CHECK_MS = 8_000;

function estimateDurationFromFileSize(sizeBytes: number): number {
  // Conservative ~80 KB/s so we over-estimate duration on growing captures
  // (under-estimates previously capped Twitch previews around ~1 hour).
  return sizeBytes / (80 * 1024);
}

function recordingElapsedSeconds(startedAt?: Date | null): number {
  if (!startedAt) return 0;
  return Math.max(0, (Date.now() - startedAt.getTime()) / 1000);
}

/** Probe every source.* file — split yt-dlp tracks can disagree on duration. */
export async function probeUploadDirRecordedSeconds(
  uploadDir: string
): Promise<number> {
  const files = await listSourceCandidateFiles(uploadDir);
  let best = 0;
  for (const filePath of files) {
    try {
      best = Math.max(best, await probeMediaDurationBestEffort(filePath));
    } catch {
      // partial / growing files
    }
  }
  return best;
}

async function resolveDurationFromFile(
  absolutePath: string,
  sizeBytes: number,
  options?: {
    knownSeconds?: number;
  }
): Promise<number> {
  let recorded = options?.knownSeconds ?? 0;

  try {
    recorded = Math.max(recorded, await probeMediaDurationBestEffort(absolutePath));
  } catch {
    // partial / growing files
  }

  if (sizeBytes >= MIN_FILE_BYTES_FOR_ESTIMATE) {
    recorded = Math.max(recorded, estimateDurationFromFileSize(sizeBytes));
  }

  return recorded;
}

/** In-memory handles for active yt-dlp recording processes (dev server). */
const activeRecordings = new Map<string, ChildProcess>();
const activeRecordingErrors = new Map<string, string>();

function isLiveStatus(liveStatus: string | null | undefined): boolean {
  return liveStatus === "live" || liveStatus === "upcoming";
}

export function shouldUseLiveRecording(liveStatus: string | null | undefined): boolean {
  return isLiveStatus(liveStatus);
}

async function findRecordingFile(uploadDir: string): Promise<string | null> {
  return findBestSourceFileInDir(uploadDir);
}

async function markRecordingFailed(
  streamSessionId: string,
  detail: string,
  pid?: number | null
): Promise<void> {
  const message = `Source acquisition: ${formatYtDlpUserError(detail)}`.slice(0, 2000);
  await Promise.all([
    prisma.liveRecordingState.updateMany({
      where: {
        streamSessionId,
        ...(pid ? { pid } : {}),
      },
      data: {
        status: "failed",
        pid: null,
        lastSyncedAt: new Date(),
      },
    }),
    prisma.streamSession.update({
      where: { id: streamSessionId },
      data: { lastTranscriptionError: message },
    }),
  ]);
}

async function waitForRecordingStartup(
  streamSessionId: string,
  uploadDir: string,
  proc: ChildProcess
): Promise<void> {
  const deadline = Date.now() + RECORDING_STARTUP_CHECK_MS;
  while (Date.now() < deadline) {
    if (await findRecordingFile(uploadDir)) return;
    if (proc.exitCode !== null) break;
    await delay(250);
  }

  if (proc.exitCode !== null) {
    const detail = activeRecordingErrors.get(streamSessionId)?.trim();
    const message = detail
      ? `Live source capture exited before media arrived: ${detail}`
      : `Live source capture exited with code ${proc.exitCode}`;
    await markRecordingFailed(streamSessionId, message, proc.pid);
    throw new Error(message);
  }
}

async function upsertSourceFromFile(
  streamSessionId: string,
  absolutePath: string,
  youtubeVideoId: string,
  isLiveRecording: boolean,
  options?: { durationOverride?: number }
) {
  let stat;
  try {
    stat = await fs.stat(absolutePath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    throw err;
  }
  const relativePath = toRelativeStoragePath(absolutePath);

  let probe;
  try {
    probe = await probeMedia(absolutePath);
  } catch {
    probe = {
      durationSeconds: 0,
      width: 0,
      height: 0,
      fps: 0,
      videoCodec: null,
      audioCodec: null,
      raw: {},
    };
  }

  const durationSeconds =
    options?.durationOverride ??
    (await resolveDurationFromFile(absolutePath, stat.size, {
      knownSeconds: probe.durationSeconds || 0,
    }));

  const existing = await prisma.sourceMedia.findFirst({
    where: { streamSessionId },
    orderBy: { createdAt: "desc" },
  });

  const data = {
    originalFilename: `${youtubeVideoId}${path.extname(absolutePath)}`,
    filePath: relativePath,
    mimeType: absolutePath.endsWith(".mkv") ? "video/x-matroska" : "video/mp4",
    sizeBytes: BigInt(stat.size),
    durationSeconds: durationSeconds > 0 ? durationSeconds : null,
    isLiveRecording,
    width: probe.width || null,
    height: probe.height || null,
    fps: probe.fps || null,
    codecInfo: toJsonValue(probe.raw),
  };

  if (existing) {
    return prisma.sourceMedia.update({
      where: { id: existing.id },
      data,
    });
  }

  return prisma.sourceMedia.create({
    data: { streamSessionId, ...data },
  });
}

/**
 * Start recording a live stream from the beginning when possible.
 * Twitch sometimes has no associated VOD / live-from-start formats — then we
 * fall back to capturing from the live edge (--no-live-from-start).
 */
async function startLiveRecordingAttempt(
  streamSessionId: string,
  options?: {
    youtubeExtractorArgs?: string | null;
    liveFromStart?: boolean;
  }
) {
  const youtubeExtractorArgs = options?.youtubeExtractorArgs;
  const liveFromStart = options?.liveFromStart ?? true;

  const session = await prisma.streamSession.findUnique({
    where: { id: streamSessionId },
    include: { liveRecording: true, sourceMedia: { take: 1 } },
  });
  if (!session) throw new Error("Session not found");

  const invocation = await resolveYtDlpInvocation();
  if (!invocation) {
    throw new Error(
      "yt-dlp is not installed. Set YT_DLP_PATH in .env (see README)."
    );
  }

  if (session.liveRecording?.status === "recording") {
    const synced = await syncLiveRecording(streamSessionId);
    if (synced.status === "recording" || synced.recordedSeconds > 0) {
      return synced;
    }
  }

  const uploadDir = getUploadDir(streamSessionId);
  await ensureDir(uploadDir);
  const outputPath = path.join(uploadDir, "source.mkv");
  const captureUrl = resolveStreamCaptureUrl(session);
  const platform = detectDownloadPlatform(captureUrl);

  const args = [
    ...invocation.prefixArgs,
    ...(await getYtDlpDeploymentArgs(platform)),
    ...(youtubeExtractorArgs === undefined
      ? baseYtDlpArgs({ platform, url: captureUrl })
      : baseYtDlpArgs({ platform, url: captureUrl, youtubeExtractorArgs })),
    liveFromStart ? "--live-from-start" : "--no-live-from-start",
    "-f",
    liveFormat(),
    "--merge-output-format",
    "mkv",
    "--no-part",
    "-o",
    outputPath,
    captureUrl,
  ];

  const proc = spawn(invocation.command, args, {
    detached: true,
    stdio: ["ignore", "ignore", "pipe"],
    shell: false,
    windowsHide: true,
  });
  activeRecordingErrors.delete(streamSessionId);
  proc.stderr?.setEncoding("utf8");
  proc.stderr?.on("data", (chunk: string) => {
    const previous = activeRecordingErrors.get(streamSessionId) ?? "";
    activeRecordingErrors.set(
      streamSessionId,
      `${previous}${chunk}`.slice(-12_000)
    );
  });
  proc.unref();
  activeRecordings.set(streamSessionId, proc);

  // YouTube live DASH often writes video-only until merge; start bestaudio now
  // so Whisper does not wait for the first failed /transcribe poll.
  try {
    const { startCompanionAudioForSession } = await import(
      "@/services/companionAudioService"
    );
    startCompanionAudioForSession(streamSessionId, captureUrl, {
      isLive: true,
      liveFromStart,
    });
  } catch {
    // non-fatal — transcription path will retry
  }

  await prisma.liveRecordingState.upsert({
    where: { streamSessionId },
    create: {
      streamSessionId,
      status: "recording",
      pid: proc.pid ?? null,
      startedAt: new Date(),
      lastSyncedAt: new Date(),
    },
    update: {
      status: "recording",
      pid: proc.pid ?? null,
      startedAt: new Date(),
      lastSyncedAt: new Date(),
    },
  });

  await prisma.streamSession.update({
    where: { id: streamSessionId },
    data: { lastTranscriptionError: null },
  });

  proc.once("close", (code) => {
    if (activeRecordings.get(streamSessionId) !== proc) return;
    activeRecordings.delete(streamSessionId);
    const detail = activeRecordingErrors.get(streamSessionId)?.trim();
    const cleanupErrorBuffer = setTimeout(() => {
      if (!activeRecordings.has(streamSessionId)) {
        activeRecordingErrors.delete(streamSessionId);
      }
    }, 30_000);
    cleanupErrorBuffer.unref();
    void (async () => {
      if (code !== 0) {
        await markRecordingFailed(
          streamSessionId,
          detail || `Live source capture exited with code ${code}`,
          proc.pid
        );
        return;
      }

      const synced = await syncLiveRecording(streamSessionId);
      if (synced.recordedSeconds <= 0) {
        await markRecordingFailed(
          streamSessionId,
          "Live source capture completed without producing media",
          proc.pid
        );
        return;
      }

      await prisma.liveRecordingState.updateMany({
        where: { streamSessionId },
        data: {
          status: "completed",
          pid: null,
          lastSyncedAt: new Date(),
        },
      });
    })().catch((error) => {
      console.error(`[source] failed to finalize ${streamSessionId}:`, error);
    });
  });

  await waitForRecordingStartup(streamSessionId, uploadDir, proc);

  const startedFile = await findRecordingFile(uploadDir);
  if (startedFile) {
    const synced = await syncLiveRecording(streamSessionId);
    if (synced.sourceMedia) return synced;
  }

  // Placeholder until file appears on disk
  const sourceMedia =
    session.sourceMedia[0] ??
    (await prisma.sourceMedia.create({
      data: {
        streamSessionId,
        originalFilename: `${session.youtubeVideoId}.mkv`,
        filePath: toRelativeStoragePath(outputPath),
        mimeType: "video/x-matroska",
        sizeBytes: BigInt(0),
        durationSeconds: 0,
        isLiveRecording: true,
      },
    }));

  return {
    status: "recording" as const,
    recordedSeconds: 0,
    sourceMedia,
  };
}

function isYouTubeAccessBlock(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /HTTP Error 429|Too Many Requests|confirm you(?:'|’)re not a bot|LOGIN_REQUIRED|sign in to confirm/i.test(
    message
  );
}

/** Twitch often has no associated VOD, so --live-from-start cannot work. */
function isLiveFromStartUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /no formats that can be downloaded from the start|Unable to extract the VOD associated|--live-from-start is passed/i.test(
    message
  );
}

export async function startLiveRecording(streamSessionId: string) {
  try {
    return await startLiveRecordingAttempt(streamSessionId, {
      liveFromStart: true,
    });
  } catch (initialError) {
    if (isLiveFromStartUnavailable(initialError)) {
      try {
        const { clearCompanionAudioState } = await import(
          "@/services/companionAudioService"
        );
        clearCompanionAudioState(streamSessionId);
      } catch {
        // ignore
      }
      activeRecordingErrors.delete(streamSessionId);
      console.warn(
        `[source] live-from-start unavailable for ${streamSessionId}; capturing from live edge`
      );
      return await startLiveRecordingAttempt(streamSessionId, {
        liveFromStart: false,
      });
    }

    if (!isYouTubeAccessBlock(initialError)) throw initialError;

    const visitorData = await getYtDlpVisitorData();
    if (!visitorData) throw initialError;

    const strategies = [
      `player_client=android_vr;player_skip=webpage,configs;visitor_data=${visitorData}`,
      `player_client=mweb;player_skip=webpage,configs;visitor_data=${visitorData}`,
      `player_client=default;player_skip=webpage,configs;visitor_data=${visitorData}`,
    ];
    let lastError = initialError;

    for (const extractorArgs of strategies) {
      try {
        return await startLiveRecordingAttempt(streamSessionId, {
          youtubeExtractorArgs: extractorArgs,
          liveFromStart: true,
        });
      } catch (error) {
        if (isLiveFromStartUnavailable(error)) {
          try {
            const { clearCompanionAudioState } = await import(
              "@/services/companionAudioService"
            );
            clearCompanionAudioState(streamSessionId);
          } catch {
            // ignore
          }
          return await startLiveRecordingAttempt(streamSessionId, {
            youtubeExtractorArgs: extractorArgs,
            liveFromStart: false,
          });
        }
        lastError = error;
      }
    }

    throw lastError;
  }
}

/** Refresh recorded duration/size from the growing file on disk. */
export async function syncLiveRecording(streamSessionId: string) {
  const session = await prisma.streamSession.findUnique({
    where: { id: streamSessionId },
    include: { liveRecording: true },
  });
  if (!session) throw new Error("Session not found");

  const uploadDir = getUploadDir(streamSessionId);
  const filePath = await findRecordingFile(uploadDir);

  if (!filePath || !existsSync(filePath)) {
    const state = session.liveRecording;
    const stalled =
      state?.status === "recording" &&
      state.startedAt &&
      Date.now() - state.startedAt.getTime() >= RECORDING_STARTUP_TIMEOUT_MS;
    if (stalled) {
      const detail = activeRecordingErrors.get(streamSessionId)?.trim();
      await markRecordingFailed(
        streamSessionId,
        detail || "Live source capture produced no media within 60 seconds",
        state.pid
      );
      return {
        status: "failed" as const,
        recordedSeconds: 0,
        sourceMedia: null,
      };
    }
    return {
      status: state?.status ?? "recording",
      recordedSeconds: state?.recordedSeconds ?? 0,
      sourceMedia: null,
    };
  }

  const sourceMedia = await upsertSourceFromFile(
    streamSessionId,
    filePath,
    session.youtubeVideoId,
    session.liveRecording?.status === "recording",
    { durationOverride: await probeUploadDirRecordedSeconds(uploadDir) }
  );

  if (!sourceMedia) {
    const state = session.liveRecording;
    return {
      status: state?.status ?? "recording",
      recordedSeconds: state?.recordedSeconds ?? 0,
      sourceMedia: null,
    };
  }

  const recordedSeconds = sourceMedia.durationSeconds ?? 0;

  void syncPreviewMp4(streamSessionId, filePath).catch(() => {});

  await prisma.liveRecordingState.upsert({
    where: { streamSessionId },
    create: {
      streamSessionId,
      status: "recording",
      recordedSeconds,
      lastSyncedAt: new Date(),
      startedAt: new Date(),
    },
    update: {
      recordedSeconds,
      lastSyncedAt: new Date(),
    },
  });

  return {
    status: session.liveRecording?.status ?? "recording",
    recordedSeconds,
    sourceMedia,
  };
}

export async function stopLiveRecording(
  streamSessionId: string,
  options?: { skipSync?: boolean }
) {
  const proc = activeRecordings.get(streamSessionId);
  const pids = new Set<number>();
  if (proc?.pid) pids.add(proc.pid);
  activeRecordings.delete(streamSessionId);
  activeRecordingErrors.delete(streamSessionId);

  const state = await prisma.liveRecordingState.findUnique({
    where: { streamSessionId },
  });
  if (state?.pid) pids.add(state.pid);

  for (const pid of pids) {
    killProcessTree(pid);
  }

  await prisma.liveRecordingState.updateMany({
    where: { streamSessionId },
    data: { status: "stopped", pid: null },
  });

  await prisma.sourceMedia.updateMany({
    where: { streamSessionId },
    data: { isLiveRecording: false },
  });

  if (options?.skipSync) {
    return {
      status: "stopped" as const,
      recordedSeconds: state?.recordedSeconds ?? 0,
      sourceMedia: null,
    };
  }

  // Let Windows release file handles after yt-dlp/ffmpeg exit.
  await delay(800);
  return syncLiveRecording(streamSessionId);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Kill process + children (yt-dlp spawns ffmpeg on Windows). */
function killProcessTree(pid: number) {
  if (!pid || pid <= 0) return;
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    } else {
      process.kill(pid, "SIGTERM");
    }
  } catch {
    // already exited
  }
}

/** Unified entry: live → record, VOD → full download. */
async function acquireSourceMediaOnce(streamSessionId: string) {
  const { refreshSessionLiveMetadata } = await import("@/services/youtubeService");
  try {
    await refreshSessionLiveMetadata(streamSessionId);
  } catch {
    // continue with cached metadata
  }

  let session = await prisma.streamSession.findUnique({
    where: { id: streamSessionId },
    include: { sourceMedia: { take: 1 }, liveRecording: true },
  });
  if (!session) throw new Error("Session not found");

  let useLiveRecording =
    shouldUseLiveRecording(session.liveStatus) ||
    (!!session.actualStartTime &&
      session.liveStatus !== "post_live" &&
      session.liveStatus !== "completed" &&
      session.liveStatus !== "none");

  if (!useLiveRecording) {
    // Data API liveStatus can lag or be missing; yt-dlp is authoritative for
    // "is this URL currently live?" — otherwise we hang forever on a VOD-style
    // bestvideo+bestaudio download of an endless stream (video-only f303, no
    // Whisper audio, and /transcribe never completes).
    try {
      const { probeYtDlpLiveStatus } = await import(
        "@/services/ytDlpMetadataService"
      );
      const probed = await probeYtDlpLiveStatus(session.youtubeUrl);
      if (probed === "live" || probed === "upcoming") {
        await prisma.streamSession.update({
          where: { id: streamSessionId },
          data: { liveStatus: probed },
        });
        useLiveRecording = true;
      }
    } catch {
      // fall through to VOD download
    }
  }

  if (useLiveRecording) {
    return startLiveRecording(streamSessionId);
  }

  if (session.liveRecording?.status === "recording") {
    await stopLiveRecording(streamSessionId, { skipSync: true });
  }

  const { downloadSourceFromYouTube } = await import(
    "@/services/youtubeDownloadService"
  );
  // Start companion audio in parallel — mid-download DASH is often video-only.
  try {
    const { startCompanionAudioForSession } = await import(
      "@/services/companionAudioService"
    );
    const { resolveStreamCaptureUrl } = await import(
      "@/services/youtubeDownloadService"
    );
    startCompanionAudioForSession(
      streamSessionId,
      resolveStreamCaptureUrl(session),
      { isLive: false }
    );
  } catch {
    // non-fatal
  }
  const media = await downloadSourceFromYouTube(streamSessionId);
  return {
    status: "completed" as const,
    recordedSeconds: media.durationSeconds ?? 0,
    sourceMedia: media,
  };
}

const activeSourceAcquisitions = new Map<
  string,
  ReturnType<typeof acquireSourceMediaOnce>
>();

export function acquireSourceMedia(streamSessionId: string) {
  const active = activeSourceAcquisitions.get(streamSessionId);
  if (active) return active;

  const acquisition = acquireSourceMediaOnce(streamSessionId);
  activeSourceAcquisitions.set(streamSessionId, acquisition);
  const release = () => {
    if (activeSourceAcquisitions.get(streamSessionId) === acquisition) {
      activeSourceAcquisitions.delete(streamSessionId);
    }
  };
  void acquisition.then(release, release);
  return acquisition;
}

export function getRecordedSecondsForSession(
  sourceMedia?: { durationSeconds?: number | null; isLiveRecording?: boolean } | null,
  liveRecording?: { recordedSeconds?: number } | null
): number {
  // Don't let a stale liveRecording(0) mask a completed download duration
  return Math.max(
    liveRecording?.recordedSeconds ?? 0,
    sourceMedia?.durationSeconds ?? 0
  );
}

/** Best known captured length from files on disk (not stream wall-clock). */
export async function resolveSourceRecordedSeconds(
  streamSessionId: string
): Promise<number> {
  const session = await prisma.streamSession.findUnique({
    where: { id: streamSessionId },
    select: {
      metadataJson: true,
      actualStartTime: true,
      liveStatus: true,
      sourceMedia: { orderBy: { createdAt: "desc" }, take: 1 },
      liveRecording: true,
    },
  });
  if (!session) return 0;

  const sourceMedia = session.sourceMedia[0] ?? null;
  const liveRecording = session.liveRecording;
  let recorded = getRecordedSecondsForSession(sourceMedia, liveRecording);

  const uploadDir = getUploadDir(streamSessionId);
  recorded = Math.max(recorded, await probeUploadDirRecordedSeconds(uploadDir));

  if (recorded >= MIN_RECORDED_SECONDS) return recorded;

  const { resolveVideoDurationFromMetadata } = await import("@/lib/youtube");
  const metadataDuration = resolveVideoDurationFromMetadata(
    session.metadataJson,
    {
      actualStartTime: session.actualStartTime,
      liveStatus: session.liveStatus,
    }
  );
  if (metadataDuration >= MIN_RECORDED_SECONDS) {
    recorded = Math.max(recorded, metadataDuration);
  }

  return recorded;
}

/** Gate before starting transcription — allows a growing capture to warm up. */
export async function canAttemptTranscription(
  streamSessionId: string
): Promise<boolean> {
  const recorded = await resolveSourceRecordedSeconds(streamSessionId);
  if (recorded >= MIN_RECORDED_SECONDS) return true;

  const session = await prisma.streamSession.findUnique({
    where: { id: streamSessionId },
    select: { liveRecording: { select: { status: true, startedAt: true } } },
  });
  if (
    session?.liveRecording?.status === "recording" &&
    recordingElapsedSeconds(session.liveRecording.startedAt) >=
      MIN_RECORDED_SECONDS
  ) {
    return true;
  }

  const files = await listSourceCandidateFiles(getUploadDir(streamSessionId));
  for (const filePath of files) {
    const size = await fs.stat(filePath).then((s) => s.size).catch(() => 0);
    if (size >= MIN_FILE_BYTES_FOR_ESTIMATE) return true;
  }

  return false;
}

/** @deprecated Use ensureClipSourceForRender — kept for live-only guardrails */
export function assertClipWithinRecording(
  endTimeSeconds: number,
  recordedSeconds: number,
  isLive: boolean
) {
  const buffer = isLive ? 8 : 0;
  if (isLive && recordedSeconds > 0 && endTimeSeconds > recordedSeconds - buffer) {
    throw new Error(
      `Clip ends at ${Math.floor(endTimeSeconds)}s but only ${Math.floor(recordedSeconds)}s has been recorded so far. Wait a moment and try again.`
    );
  }
}

export async function getSourceFilePath(streamSessionId: string): Promise<string> {
  const media = await prisma.sourceMedia.findFirst({
    where: { streamSessionId },
    orderBy: { createdAt: "desc" },
  });
  if (!media) throw new Error("No source media available");
  const full = resolveStoragePath(media.filePath);
  if (!existsSync(full)) throw new Error("Recording file not found on disk yet");
  return full;
}
