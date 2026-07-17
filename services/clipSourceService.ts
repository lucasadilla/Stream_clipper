import path from "path";
import { existsSync } from "fs";
import { prisma } from "@/lib/db";
import { getFfmpegPath, hasVideoStream, probeMedia, runCommand } from "@/lib/ffmpeg";
import { toJsonValue } from "@/lib/utils";
import { MIN_CLIP_SECONDS } from "@/lib/clipConstants";
import {
  getUploadDir,
  ensureDir,
  toRelativeStoragePath,
  resolveStoragePath,
  fileExists,
  findBestSourceFileInDir,
  listSourceCandidateFiles,
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

/**
 * Live yt-dlp captures are separate growing video/audio files until the stream
 * ends. Build a small, finalized MP4 for the requested range so rendering never
 * depends on an unfinished preview.mp4 (which has no moov atom yet).
 */
async function createMuxedLiveSegment(
  streamSessionId: string,
  startTimeSeconds: number,
  endTimeSeconds: number
): Promise<{ path: string; duration: number } | null> {
  const candidates = await listSourceCandidateFiles(
    getUploadDir(streamSessionId)
  );
  let videoPath: string | null = null;
  let audioPath: string | null = null;

  // Prefer filename heuristics so we don't ffprobe multi-hour files first.
  for (const candidate of candidates) {
    const name = path.basename(candidate).toLowerCase();
    if (isSegmentFile(name)) continue;
    // Common yt-dlp audio-only format ids.
    if (/\.f(139|140|249|250|251)\./.test(name)) {
      if (!audioPath) audioPath = candidate;
      continue;
    }
    // Common yt-dlp video-only format ids (no audio).
    if (/\.f(298|299|137|136|135|134|133|160|278|242|243|244|247)\./.test(name)) {
      if (!videoPath) videoPath = candidate;
      continue;
    }
  }

  for (const candidate of candidates) {
    if (videoPath && audioPath) break;
    if (candidate === videoPath || candidate === audioPath) continue;
    if (isSegmentFile(path.basename(candidate))) continue;
    try {
      const media = await probeMedia(candidate);
      if (!videoPath && media.videoCodec) videoPath = candidate;
      if (!audioPath && media.audioCodec) audioPath = candidate;
    } catch {
      // Ignore incomplete candidates and continue looking for readable tracks.
    }
  }

  if (!videoPath || !audioPath || videoPath === audioPath) return null;

  const segmentStart = Math.floor(Math.max(0, startTimeSeconds));
  const segmentEnd = Math.ceil(endTimeSeconds);
  const duration = segmentEnd - segmentStart;
  if (duration < MIN_CLIP_SECONDS) return null;

  const uploadDir = getUploadDir(streamSessionId);
  await ensureDir(uploadDir);
  const name = `segment-${segmentStart}-${segmentEnd}.mp4`;
  const outputPath = path.join(uploadDir, name);

  if (existsSync(outputPath)) {
    try {
      const probe = await probeMedia(outputPath);
      if (probe.videoCodec && probe.durationSeconds >= MIN_CLIP_SECONDS) {
        return { path: outputPath, duration: probe.durationSeconds };
      }
    } catch {
      // Replace stale/partial segment atomically below.
    }
  }

  const tempPath = `${outputPath}.${process.pid}-${Date.now()}.tmp.mp4`;
  const fs = await import("fs/promises");
  try {
    await runCommand(getFfmpegPath(), [
      "-y",
      "-nostdin",
      "-loglevel",
      "error",
      "-ss",
      String(segmentStart),
      "-i",
      videoPath,
      "-ss",
      String(segmentStart),
      "-i",
      audioPath,
      "-t",
      String(duration),
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c",
      "copy",
      "-avoid_negative_ts",
      "make_zero",
      "-movflags",
      "+faststart",
      tempPath,
    ]);

    const probe = await probeMedia(tempPath);
    if (!probe.videoCodec || probe.durationSeconds < MIN_CLIP_SECONDS) {
      throw new Error("Captured video range is not readable yet");
    }
    await fs.rename(tempPath, outputPath);
    return { path: outputPath, duration: probe.durationSeconds };
  } finally {
    await fs.unlink(tempPath).catch(() => {});
  }
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
  // Growing live files often fail ffprobe; trust the recording counter.
  if (isLiveRecording && liveRecordedSeconds > 0) {
    if (!clipEndSeconds || liveRecordedSeconds >= clipEndSeconds - 0.5) {
      return liveRecordedSeconds;
    }
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
  const activelyRecording = isActivelyRecordingLive(session);

  const allSources = await prisma.sourceMedia.findMany({
    where: { streamSessionId },
    orderBy: { createdAt: "desc" },
  });

  // 1. preview.mp4 — only use it after a successful structural probe. File
  // existence/size is insufficient because MP4 writes its moov atom at EOF.
  const previewPath = getPreviewMp4Path(streamSessionId);
  if (existsSync(previewPath)) {
    try {
      const previewProbe = await probeMedia(previewPath);
      if (previewProbe.videoCodec && previewProbe.durationSeconds >= MIN_CLIP_SECONDS) {
        const previewMedia = await ensureSourceMediaRow(streamSessionId, previewPath, {
          originalFilename: "preview.mp4",
          durationSeconds: previewProbe.durationSeconds,
          isLiveRecording: true,
        });
        const local = localClipFromSource({
          sourceMediaId: previewMedia.id,
          startTimeSeconds,
          endTimeSeconds,
          availableDuration: previewProbe.durationSeconds,
        });
        if (local) return local;
      }
    } catch {
      // Unfinalized live preview; continue to other sources.
    }
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
        isLiveRecording: activelyRecording,
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
    if (
      (sourceMedia.width ?? 0) <= 0 &&
      !(await hasVideoStream(absolutePath))
    ) {
      continue;
    }
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

  // 4. Split live video/audio tracks — only when no usable combined file covers
  // the range. Muxing a multi-hour capture is expensive; keep it as fallback.
  if (activelyRecording || !mainAbsolute) {
    const muxed = await createMuxedLiveSegment(
      streamSessionId,
      startTimeSeconds,
      endTimeSeconds
    ).catch((error) => {
      console.warn("[render] Could not prepare split live capture:", error);
      return null;
    });
    if (muxed) {
      const muxedMedia = await ensureSourceMediaRow(streamSessionId, muxed.path, {
        originalFilename: path.basename(muxed.path),
        durationSeconds: muxed.duration,
        isLiveRecording: false,
      });
      return {
        sourceMediaId: muxedMedia.id,
        renderStart: startTimeSeconds - Math.floor(startTimeSeconds),
        renderEnd: Math.min(
          endTimeSeconds - Math.floor(startTimeSeconds),
          muxed.duration
        ),
      };
    }
  }

  // 5. Last resort: fetch segment from stream (slow). Prefer failing clearly when
  // a local live buffer exists but hasn't reached the clip end yet.
  const localMainExists = Boolean(mainAbsolute && existsSync(mainAbsolute));
  if (
    localMainExists &&
    liveRecordedSeconds > 0 &&
    startTimeSeconds < liveRecordedSeconds - 0.25
  ) {
    if (endTimeSeconds > liveRecordedSeconds + 0.75) {
      throw new Error(
        "Recording has not reached the end of this clip yet. Wait for the live buffer to catch up, then save again."
      );
    }
    // Trust recordedSeconds even if probe failed earlier on a growing file.
    const existingMain =
      allSources.find(
        (s) =>
          mainAbsolute &&
          s.filePath === toRelativeStoragePath(mainAbsolute)
      ) ??
      (mainAbsolute
        ? await ensureSourceMediaRow(streamSessionId, mainAbsolute, {
            originalFilename: path.basename(mainAbsolute),
            durationSeconds: liveRecordedSeconds,
            isLiveRecording: activelyRecording,
          })
        : null);
    if (existingMain) {
      const local = localClipFromSource({
        sourceMediaId: existingMain.id,
        startTimeSeconds,
        endTimeSeconds,
        availableDuration: liveRecordedSeconds,
      });
      if (local) return local;
    }
  }

  if (localMainExists || allSources.some((s) => fileExists(s.filePath))) {
    console.warn(
      "[render] Falling through to yt-dlp despite local media present",
      { streamSessionId, startTimeSeconds, endTimeSeconds, liveRecordedSeconds }
    );
  }

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
