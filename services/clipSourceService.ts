import path from "path";
import { existsSync } from "fs";
import { prisma } from "@/lib/db";
import { probeMedia } from "@/lib/ffmpeg";
import { toJsonValue } from "@/lib/utils";
import {
  getUploadDir,
  ensureDir,
  toRelativeStoragePath,
  resolveStoragePath,
  fileExists,
} from "@/lib/storage";
import {
  downloadClipSegmentFromYouTube,
  isYtDlpAvailable,
} from "@/services/youtubeDownloadService";
import { getPreviewMp4Path } from "@/services/previewVideoService";

function formatYtDlpTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Best known duration: local video, live buffer, transcripts, or chat timestamps. */
export async function getKnownStreamDurationSeconds(
  streamSessionId: string,
  sourceMedia?: { durationSeconds?: number | null } | null,
  liveRecording?: { recordedSeconds?: number } | null
): Promise<number> {
  const fromVideo = Math.max(
    liveRecording?.recordedSeconds ?? 0,
    sourceMedia?.durationSeconds ?? 0
  );
  if (fromVideo > 0) return fromVideo;

  const [transcriptMax, chatMax] = await Promise.all([
    prisma.transcriptChunk.aggregate({
      where: { streamSessionId },
      _max: { endTimeSeconds: true },
    }),
    prisma.chatMessage.aggregate({
      where: { streamSessionId, videoTimeSeconds: { not: null } },
      _max: { videoTimeSeconds: true },
    }),
  ]);

  return Math.max(
    transcriptMax._max.endTimeSeconds ?? 0,
    chatMax._max.videoTimeSeconds ?? 0
  );
}

export function isActivelyRecordingLive(session: {
  liveStatus?: string | null;
  liveRecording?: { status?: string } | null;
}): boolean {
  const isLive =
    session.liveStatus === "live" || session.liveStatus === "upcoming";
  const recording = session.liveRecording?.status === "recording";
  return isLive && recording;
}

async function resolveSourceDurationSeconds(
  sourceMedia: { filePath: string; durationSeconds?: number | null },
  liveRecordedSeconds?: number
): Promise<number> {
  let duration = Math.max(
    sourceMedia.durationSeconds ?? 0,
    liveRecordedSeconds ?? 0
  );

  if (duration > 0) return duration;

  if (!fileExists(sourceMedia.filePath)) return 0;

  try {
    duration = (await probeMedia(resolveStoragePath(sourceMedia.filePath)))
      .durationSeconds;
  } catch {
    return liveRecordedSeconds ?? 0;
  }

  return Math.max(duration, liveRecordedSeconds ?? 0);
}

async function localSourceCoversRange(
  sourceMedia: { filePath: string; durationSeconds?: number | null },
  endTimeSeconds: number,
  liveRecordedSeconds?: number
): Promise<boolean> {
  if (!fileExists(sourceMedia.filePath)) return false;

  const duration = await resolveSourceDurationSeconds(
    sourceMedia,
    liveRecordedSeconds
  );

  return duration >= endTimeSeconds - 0.5;
}

async function ensurePreviewSourceMedia(
  streamSessionId: string,
  absolutePath: string,
  durationSeconds: number
) {
  const relativePath = toRelativeStoragePath(absolutePath);
  const existing = await prisma.sourceMedia.findFirst({
    where: { streamSessionId, filePath: relativePath },
  });
  if (existing) return existing;

  const stat = await import("fs/promises").then((fs) => fs.stat(absolutePath));

  return prisma.sourceMedia.create({
    data: {
      streamSessionId,
      originalFilename: "preview.mp4",
      filePath: relativePath,
      mimeType: "video/mp4",
      sizeBytes: BigInt(stat.size),
      durationSeconds,
      isLiveRecording: true,
    },
  });
}

/**
 * Ensure we have local video covering [start, end].
 * Uses existing file when possible; otherwise downloads just that segment from YouTube.
 */
export async function ensureClipSourceForRender(
  streamSessionId: string,
  startTimeSeconds: number,
  endTimeSeconds: number,
  preferredSourceMediaId?: string
): Promise<{
  sourceMediaId: string;
  renderStart: number;
  renderEnd: number;
}> {
  const session = await prisma.streamSession.findUnique({
    where: { id: streamSessionId },
    include: { liveRecording: true },
  });
  if (!session) throw new Error("Session not found");

  const liveRecordedSeconds = session.liveRecording?.recordedSeconds ?? 0;

  if (isActivelyRecordingLive(session)) {
    const buffer = 2;
    if (
      liveRecordedSeconds > 0 &&
      endTimeSeconds > liveRecordedSeconds - buffer
    ) {
      throw new Error(
        `Only ${Math.floor(liveRecordedSeconds)}s has been captured so far. Wait for recording to catch up, then try again.`
      );
    }
  }

  const allSources = await prisma.sourceMedia.findMany({
    where: { streamSessionId },
    orderBy: { createdAt: "desc" },
  });

  const orderedSources = preferredSourceMediaId
    ? [
        ...allSources.filter((s) => s.id === preferredSourceMediaId),
        ...allSources.filter((s) => s.id !== preferredSourceMediaId),
      ]
    : allSources;

  for (const sourceMedia of orderedSources) {
    if (
      await localSourceCoversRange(
        sourceMedia,
        endTimeSeconds,
        liveRecordedSeconds
      )
    ) {
      const segmentMatch = sourceMedia.originalFilename.match(
        /^segment-(\d+)-(\d+)\.mp4$/i
      );
      if (segmentMatch) {
        const segmentStart = parseInt(segmentMatch[1], 10);
        return {
          sourceMediaId: sourceMedia.id,
          renderStart: startTimeSeconds - segmentStart,
          renderEnd: endTimeSeconds - segmentStart,
        };
      }

      return {
        sourceMediaId: sourceMedia.id,
        renderStart: startTimeSeconds,
        renderEnd: endTimeSeconds,
      };
    }
  }

  const previewPath = getPreviewMp4Path(streamSessionId);
  if (existsSync(previewPath)) {
    let previewDuration = 0;
    try {
      previewDuration = (await probeMedia(previewPath)).durationSeconds;
    } catch {
      previewDuration = liveRecordedSeconds;
    }
    previewDuration = Math.max(previewDuration, liveRecordedSeconds);

    if (previewDuration >= endTimeSeconds - 0.5) {
      const previewMedia = await ensurePreviewSourceMedia(
        streamSessionId,
        previewPath,
        previewDuration
      );
      return {
        sourceMediaId: previewMedia.id,
        renderStart: startTimeSeconds,
        renderEnd: endTimeSeconds,
      };
    }
  }

  const ytDlpOk = await isYtDlpAvailable();
  if (!ytDlpOk) {
    throw new Error(
      "No local video for this clip yet. Wait for the source download to finish, or install yt-dlp."
    );
  }

  if (isActivelyRecordingLive(session)) {
    throw new Error(
      "Local recording does not cover this clip range yet. Wait a few seconds and try again."
    );
  }

  const leadIn = 3;
  const trailOut = 3;
  const segmentStart = Math.max(0, startTimeSeconds - leadIn);
  const segmentEnd = endTimeSeconds + trailOut;

  const uploadDir = getUploadDir(streamSessionId);
  await ensureDir(uploadDir);
  const segmentName = `segment-${Math.floor(segmentStart)}-${Math.floor(segmentEnd)}.mp4`;
  const absolutePath = path.join(uploadDir, segmentName);

  if (!existsSync(absolutePath)) {
    await downloadClipSegmentFromYouTube(
      session.youtubeUrl,
      formatYtDlpTime(segmentStart),
      formatYtDlpTime(segmentEnd),
      absolutePath
    );
  }

  const relativePath = toRelativeStoragePath(absolutePath);
  let probe;
  try {
    probe = await probeMedia(absolutePath);
  } catch {
    probe = {
      durationSeconds: segmentEnd - segmentStart,
      width: 0,
      height: 0,
      fps: 0,
      videoCodec: null,
      audioCodec: null,
      raw: {},
    };
  }

  const stat = await import("fs/promises").then((fs) => fs.stat(absolutePath));

  const existingSegment = allSources.find((s) => s.filePath === relativePath);
  const segmentMedia =
    existingSegment ??
    (await prisma.sourceMedia.create({
      data: {
        streamSessionId,
        originalFilename: segmentName,
        filePath: relativePath,
        mimeType: "video/mp4",
        sizeBytes: BigInt(stat.size),
        durationSeconds: probe.durationSeconds || segmentEnd - segmentStart,
        width: probe.width || null,
        height: probe.height || null,
        fps: probe.fps || null,
        codecInfo: toJsonValue(probe.raw),
        isLiveRecording: false,
      },
    }));

  const renderStart = startTimeSeconds - segmentStart;
  const renderEnd = endTimeSeconds - segmentStart;

  return {
    sourceMediaId: segmentMedia.id,
    renderStart,
    renderEnd,
  };
}
