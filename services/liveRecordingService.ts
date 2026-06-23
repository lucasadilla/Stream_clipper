import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import { type ChildProcess, spawn } from "child_process";
import { prisma } from "@/lib/db";
import { probeMedia } from "@/lib/ffmpeg";
import { toJsonValue } from "@/lib/utils";
import {
  getUploadDir,
  ensureDir,
  toRelativeStoragePath,
  resolveStoragePath,
} from "@/lib/storage";
import { getYtDlpPath, isYtDlpAvailable } from "@/services/youtubeDownloadService";

/** In-memory handles for active yt-dlp recording processes (dev server). */
const activeRecordings = new Map<string, ChildProcess>();

function isLiveStatus(liveStatus: string | null | undefined): boolean {
  return liveStatus === "live" || liveStatus === "upcoming";
}

function isVodStatus(liveStatus: string | null | undefined): boolean {
  return (
    liveStatus === "post_live" ||
    liveStatus === "none" ||
    liveStatus === "completed" ||
    !liveStatus
  );
}

async function findRecordingFile(uploadDir: string): Promise<string | null> {
  if (!existsSync(uploadDir)) return null;
  const files = await fs.readdir(uploadDir);
  const candidates = files.filter(
    (f) =>
      f.startsWith("source.") &&
      !f.endsWith(".part") &&
      !f.endsWith(".ytdl")
  );
  if (candidates.length === 0) return null;
  // Prefer mkv/mp4 with largest size (active recording)
  let best = candidates[0];
  let bestSize = 0;
  for (const f of candidates) {
    const stat = await fs.stat(path.join(uploadDir, f));
    if (stat.size > bestSize) {
      bestSize = stat.size;
      best = f;
    }
  }
  return path.join(uploadDir, best);
}

async function upsertSourceFromFile(
  streamSessionId: string,
  absolutePath: string,
  youtubeVideoId: string,
  isLiveRecording: boolean
) {
  const stat = await fs.stat(absolutePath);
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

  const existing = await prisma.sourceMedia.findFirst({
    where: { streamSessionId },
    orderBy: { createdAt: "desc" },
  });

  const data = {
    originalFilename: `${youtubeVideoId}${path.extname(absolutePath)}`,
    filePath: relativePath,
    mimeType: absolutePath.endsWith(".mkv") ? "video/x-matroska" : "video/mp4",
    sizeBytes: BigInt(stat.size),
    durationSeconds: probe.durationSeconds || null,
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
 * Start recording a live stream from the beginning (or continue).
 * Uses mkv for safer partial-file reads while recording.
 */
export async function startLiveRecording(streamSessionId: string) {
  const session = await prisma.streamSession.findUnique({
    where: { id: streamSessionId },
    include: { liveRecording: true, sourceMedia: { take: 1 } },
  });
  if (!session) throw new Error("Session not found");

  const available = await isYtDlpAvailable();
  if (!available) {
    throw new Error(
      "yt-dlp is not installed. Set YT_DLP_PATH in .env (see README)."
    );
  }

  if (session.liveRecording?.status === "recording") {
    return syncLiveRecording(streamSessionId);
  }

  const uploadDir = getUploadDir(streamSessionId);
  await ensureDir(uploadDir);
  const outputPath = path.join(uploadDir, "source.mkv");

  const ytDlp = getYtDlpPath();
  const args = [
    "--live-from-start",
    "-f",
    "bestvideo[height<=1080]+bestaudio/best[height<=1080]/best",
    "--merge-output-format",
    "mkv",
    "--no-playlist",
    "--no-part",
    "-o",
    outputPath,
    session.youtubeUrl,
  ];

  const proc = spawn(ytDlp, args, {
    detached: true,
    stdio: "ignore",
    shell: false,
    windowsHide: true,
  });
  proc.unref();
  activeRecordings.set(streamSessionId, proc);

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

  // Placeholder until file appears on disk
  if (!session.sourceMedia[0]) {
    await prisma.sourceMedia.create({
      data: {
        streamSessionId,
        originalFilename: `${session.youtubeVideoId}.mkv`,
        filePath: toRelativeStoragePath(outputPath),
        mimeType: "video/x-matroska",
        sizeBytes: BigInt(0),
        durationSeconds: 0,
        isLiveRecording: true,
      },
    });
  }

  return {
    status: "recording" as const,
    recordedSeconds: 0,
    sourceMedia: session.sourceMedia[0],
  };
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
    session.liveRecording?.status === "recording"
  );

  const recordedSeconds = sourceMedia.durationSeconds ?? 0;

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

export async function stopLiveRecording(streamSessionId: string) {
  const proc = activeRecordings.get(streamSessionId);
  if (proc?.pid) {
    try {
      proc.kill();
    } catch {
      // process may have already exited
    }
  }
  activeRecordings.delete(streamSessionId);

  await prisma.liveRecordingState.updateMany({
    where: { streamSessionId },
    data: { status: "stopped" },
  });

  await prisma.sourceMedia.updateMany({
    where: { streamSessionId },
    data: { isLiveRecording: false },
  });

  return syncLiveRecording(streamSessionId);
}

/** Unified entry: live → record, VOD → full download. */
export async function acquireSourceMedia(streamSessionId: string) {
  const session = await prisma.streamSession.findUnique({
    where: { id: streamSessionId },
    include: { sourceMedia: { take: 1 } },
  });
  if (!session) throw new Error("Session not found");

  if (isLiveStatus(session.liveStatus) && !isVodStatus(session.liveStatus)) {
    return startLiveRecording(streamSessionId);
  }

  // VOD / post-live — use full download
  const { downloadSourceFromYouTube } = await import(
    "@/services/youtubeDownloadService"
  );
  const media = await downloadSourceFromYouTube(streamSessionId);
  return {
    status: "completed" as const,
    recordedSeconds: media.durationSeconds ?? 0,
    sourceMedia: media,
  };
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
