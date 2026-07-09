import path from "path";
import { existsSync } from "fs";
import { prisma } from "@/lib/db";
import { probeMedia } from "@/lib/ffmpeg";
import { toJsonValue } from "@/lib/utils";
import { MIN_CLIP_SECONDS } from "@/lib/clipConstants";
import {
  getUploadDir,
  ensureDir,
  toRelativeStoragePath,
  resolveStoragePath,
  fileExists,
  findBestSourceFileInDir,
} from "@/lib/storage";
import {
  downloadClipSegmentFromStream,
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

function isSegmentFile(name: string): boolean {
  return /^segment-\d+-\d+\.mp4$/i.test(name);
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

async function resolveFileDurationSeconds(
  absolutePath: string,
  liveRecordedSeconds: number,
  isLiveRecording?: boolean,
  clipEndSeconds?: number
): Promise<number> {
  if (
    isLiveRecording &&
    liveRecordedSeconds > 0 &&
    (!clipEndSeconds || liveRecordedSeconds >= clipEndSeconds - 0.5)
  ) {
    return liveRecordedSeconds;
  }

  let duration = liveRecordedSeconds;
  try {
    duration = Math.max(
      duration,
      (await probeMedia(absolutePath)).durationSeconds
    );
  } catch {
    // growing / partial files
  }
  return Math.max(duration, liveRecordedSeconds);
}

async function ensureSourceMediaRow(
  streamSessionId: string,
  absolutePath: string,
  options: {
    originalFilename: string;
    durationSeconds: number;
    isLiveRecording?: boolean;
  }
) {
  const relativePath = toRelativeStoragePath(absolutePath);
  const existing = await prisma.sourceMedia.findFirst({
    where: { streamSessionId, filePath: relativePath },
  });
  if (existing) return existing;

  const stat = await import("fs/promises").then((fs) => fs.stat(absolutePath));
  const ext = path.extname(absolutePath).toLowerCase();

  return prisma.sourceMedia.create({
    data: {
      streamSessionId,
      originalFilename: options.originalFilename,
      filePath: relativePath,
      mimeType: ext === ".mkv" ? "video/x-matroska" : "video/mp4",
      sizeBytes: BigInt(stat.size),
      durationSeconds: options.durationSeconds,
      isLiveRecording: options.isLiveRecording ?? false,
    },
  });
}

function localClipFromSource(options: {
  sourceMediaId: string;
  segmentStart?: number;
  startTimeSeconds: number;
  endTimeSeconds: number;
  availableDuration: number;
}): {
  sourceMediaId: string;
  renderStart: number;
  renderEnd: number;
} | null {
  const { sourceMediaId, segmentStart, startTimeSeconds, endTimeSeconds } =
    options;
  const availableDuration = options.availableDuration;

  if (segmentStart != null) {
    const relStart = startTimeSeconds - segmentStart;
    const relEnd = Math.min(endTimeSeconds - segmentStart, availableDuration);
    if (relStart < 0 || relEnd - relStart < MIN_CLIP_SECONDS) return null;
    return { sourceMediaId, renderStart: relStart, renderEnd: relEnd };
  }

  if (startTimeSeconds >= availableDuration - 0.25) return null;

  const renderEnd = Math.min(endTimeSeconds, availableDuration);
  if (renderEnd - startTimeSeconds < MIN_CLIP_SECONDS) return null;

  return {
    sourceMediaId,
    renderStart: startTimeSeconds,
    renderEnd,
  };
}

/**
 * Ensure we have local video covering [start, end].
 * Prefers the on-disk recording (instant ffmpeg cut). yt-dlp segment fetch is last resort.
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
  const uploadDir = getUploadDir(streamSessionId);

  const allSources = await prisma.sourceMedia.findMany({
    where: { streamSessionId },
    orderBy: { createdAt: "desc" },
  });

  // 1. preview.mp4 — browser-playable, fast seek for render
  const previewPath = getPreviewMp4Path(streamSessionId);
  if (existsSync(previewPath)) {
    const duration = await resolveFileDurationSeconds(
      previewPath,
      liveRecordedSeconds,
      true,
      endTimeSeconds
    );
    const previewMedia = await ensureSourceMediaRow(streamSessionId, previewPath, {
      originalFilename: "preview.mp4",
      durationSeconds: duration,
      isLiveRecording: true,
    });
    const local = localClipFromSource({
      sourceMediaId: previewMedia.id,
      startTimeSeconds,
      endTimeSeconds,
      availableDuration: duration,
    });
    if (local) return local;
  }

  // 2. Main on-disk recording (source.mkv / source.mp4)
  const mainAbsolute = await findBestSourceFileInDir(uploadDir);
  if (mainAbsolute && existsSync(mainAbsolute)) {
    const mainName = path.basename(mainAbsolute);
    const relative = toRelativeStoragePath(mainAbsolute);
    const existing =
      allSources.find((s) => s.filePath === relative) ??
      (await ensureSourceMediaRow(streamSessionId, mainAbsolute, {
        originalFilename: mainName,
        durationSeconds: liveRecordedSeconds,
        isLiveRecording: isActivelyRecordingLive(session),
      }));

    const duration = await resolveFileDurationSeconds(
      mainAbsolute,
      liveRecordedSeconds,
      existing.isLiveRecording,
      endTimeSeconds
    );

    const local = localClipFromSource({
      sourceMediaId: existing.id,
      startTimeSeconds,
      endTimeSeconds,
      availableDuration: duration,
    });
    if (local) return local;
  }

  // 3. Other DB sources — main files before segments
  const orderedSources = [
    ...(preferredSourceMediaId
      ? allSources.filter((s) => s.id === preferredSourceMediaId)
      : []),
    ...allSources.filter(
      (s) =>
        s.id !== preferredSourceMediaId &&
        !isSegmentFile(s.originalFilename) &&
        s.originalFilename !== "preview.mp4"
    ),
    ...allSources.filter((s) => s.originalFilename === "preview.mp4"),
    ...allSources.filter((s) => isSegmentFile(s.originalFilename)),
  ];

  for (const sourceMedia of orderedSources) {
    if (!fileExists(sourceMedia.filePath)) continue;

    const absolutePath = resolveStoragePath(sourceMedia.filePath);
    const duration = await resolveFileDurationSeconds(
      absolutePath,
      liveRecordedSeconds,
      sourceMedia.isLiveRecording,
      endTimeSeconds
    );

    const segmentMatch = sourceMedia.originalFilename.match(
      /^segment-(\d+)-(\d+)\.mp4$/i
    );
    const segmentStart = segmentMatch ? parseInt(segmentMatch[1], 10) : undefined;

    const local = localClipFromSource({
      sourceMediaId: sourceMedia.id,
      segmentStart,
      startTimeSeconds,
      endTimeSeconds,
      availableDuration: duration,
    });
    if (local) return local;
  }

  // 4. Last resort: fetch segment from stream (slow)
  const ytDlpOk = await isYtDlpAvailable();
  if (!ytDlpOk) {
    throw new Error(
      "No local video for this clip yet. Install yt-dlp or wait for recording to start."
    );
  }

  const streamUrl = session.youtubeUrl;
  if (!streamUrl) {
    throw new Error("Session has no stream URL.");
  }

  const leadIn = 3;
  const trailOut = 3;
  const segmentStart = Math.max(0, startTimeSeconds - leadIn);
  const segmentEnd = endTimeSeconds + trailOut;

  await ensureDir(uploadDir);
  const segmentName = `segment-${Math.floor(segmentStart)}-${Math.floor(segmentEnd)}.mp4`;
  const absolutePath = path.join(uploadDir, segmentName);

  if (!existsSync(absolutePath)) {
    const fetchLiveFromStart =
      session.liveStatus === "live" ||
      session.liveStatus === "upcoming" ||
      isActivelyRecordingLive(session);

    await downloadClipSegmentFromStream(
      streamUrl,
      formatYtDlpTime(segmentStart),
      formatYtDlpTime(segmentEnd),
      absolutePath,
      { liveFromStart: fetchLiveFromStart }
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

  const existingSegment = allSources.find((s) => s.filePath === relativePath);
  const segmentMedia =
    existingSegment ??
    (await prisma.sourceMedia.create({
      data: {
        streamSessionId,
        originalFilename: segmentName,
        filePath: relativePath,
        mimeType: "video/mp4",
        sizeBytes: BigInt(
          (await import("fs/promises").then((fs) => fs.stat(absolutePath))).size
        ),
        durationSeconds: probe.durationSeconds || segmentEnd - segmentStart,
        width: probe.width || null,
        height: probe.height || null,
        fps: probe.fps || null,
        codecInfo: toJsonValue(probe.raw),
        isLiveRecording: false,
      },
    }));

  return {
    sourceMediaId: segmentMedia.id,
    renderStart: startTimeSeconds - segmentStart,
    renderEnd: endTimeSeconds - segmentStart,
  };
}
