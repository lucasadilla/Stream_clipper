import path from "path";
import { toJsonValue } from "@/lib/utils";
import { LIVE_SEGMENT_SECONDS } from "@/lib/timelineConstants";
import { TRANSCRIPTION_HEAVY_BACKLOG_SECONDS } from "@/lib/transcriptionConstants";
import { prisma } from "@/lib/db";
import { probeMedia } from "@/lib/ffmpeg";
import {
  getTranscriptionBacklog,
  syncTranscription,
} from "@/services/transcriptionSyncService";
import {
  getUploadDir,
  ensureDir,
  toRelativeStoragePath,
  isAllowedVideoFile,
} from "@/lib/storage";

const MIN_SEGMENT_SECONDS = 3;

export async function saveSourceMedia(streamSessionId: string, file: File) {
  if (!isAllowedVideoFile(file.name, file.type)) {
    throw new Error("Invalid file type. Accepted: mp4, mov, webm, mkv");
  }

  const session = await prisma.streamSession.findUnique({
    where: { id: streamSessionId },
  });
  if (!session) throw new Error("Session not found");

  const ext = path.extname(file.name) || ".mp4";
  const uploadDir = getUploadDir(streamSessionId);
  await ensureDir(uploadDir);

  const filename = `source${ext}`;
  const absolutePath = path.join(uploadDir, filename);
  const buffer = Buffer.from(await file.arrayBuffer());
  const { writeFile } = await import("fs/promises");
  await writeFile(absolutePath, buffer);

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

  await prisma.sourceMedia.deleteMany({ where: { streamSessionId } });

  return prisma.sourceMedia.create({
    data: {
      streamSessionId,
      originalFilename: file.name,
      filePath: relativePath,
      mimeType: file.type || "video/mp4",
      sizeBytes: BigInt(buffer.length),
      durationSeconds: probe.durationSeconds || null,
      width: probe.width || null,
      height: probe.height || null,
      fps: probe.fps || null,
      codecInfo: toJsonValue(probe.raw),
    },
  });
}

export async function processVideoIncremental(streamSessionId: string) {
  const sourceMedia = await prisma.sourceMedia.findFirst({
    where: { streamSessionId },
    orderBy: { createdAt: "desc" },
  });
  if (!sourceMedia) return { skipped: true, reason: "no_media" };

  const recorded = sourceMedia.durationSeconds ?? 0;
  if (recorded < MIN_SEGMENT_SECONDS) return { skipped: true, reason: "too_short" };

  const session = await prisma.streamSession.findUnique({
    where: { id: streamSessionId },
    select: { liveStatus: true },
  });
  const isLive =
    session?.liveStatus === "live" || session?.liveStatus === "upcoming";

  const { backlogSeconds } = await getTranscriptionBacklog(streamSessionId);
  const transcription = await syncTranscription(streamSessionId, { isLive });
  const heavyBacklog = backlogSeconds > TRANSCRIPTION_HEAVY_BACKLOG_SECONDS;

  if (
    !heavyBacklog &&
    !transcription.skipped &&
    (transcription.transcribedSegments ?? 0) > 0 &&
    isLive
  ) {
    const { analyzeAudioSegment } = await import("@/services/audioAnalysisService");
    const segmentEnd = transcription.transcribedThrough ?? LIVE_SEGMENT_SECONDS;
    const fromSeconds = Math.max(0, segmentEnd - LIVE_SEGMENT_SECONDS);
    try {
      await analyzeAudioSegment(
        streamSessionId,
        sourceMedia.filePath,
        fromSeconds,
        segmentEnd
      );
    } catch (err) {
      // Video-only live files have no audio track; never block transcription on this.
      console.warn("[media] audio segment analysis failed:", err);
    }
  }

  return {
    skipped: transcription.skipped,
    reason: transcription.reason,
    transcriptChunks: transcription.transcribedSegments ?? 0,
    transcribedThrough: transcription.transcribedThrough,
    recordedSeconds: transcription.recordedSeconds,
    audioSecondsProcessed: transcription.audioSecondsProcessed,
    chunksProcessed: transcription.chunksProcessed,
  };
}

export async function processVideo(streamSessionId: string) {
  const sourceMedia = await prisma.sourceMedia.findFirst({
    where: { streamSessionId },
    orderBy: { createdAt: "desc" },
  });
  if (!sourceMedia) {
    throw new Error("Source video not ready. Wait for YouTube download to finish.");
  }

  const { generateTranscript } = await import("@/services/transcriptService");
  const { analyzeAudio } = await import("@/services/audioAnalysisService");
  const { analyzeVisual } = await import("@/services/visualAnalysisService");
  const { detectFacecamRegion } = await import("@/services/facecamDetectionService");
  const { getFramesDir, resolveStoragePath } = await import("@/lib/storage");
  const { extractFrames } = await import("@/lib/ffmpeg");

  const transcript = await generateTranscript(
    streamSessionId,
    sourceMedia.filePath
  );
  const audio = await analyzeAudio(streamSessionId, sourceMedia.filePath);
  const visual = await analyzeVisual(streamSessionId, sourceMedia.filePath);

  const framesDir = getFramesDir(streamSessionId);
  const fullPath = resolveStoragePath(sourceMedia.filePath);
  const framePaths = await extractFrames(fullPath, framesDir, 2);
  await detectFacecamRegion(
    streamSessionId,
    framePaths,
    sourceMedia.width ?? 1920,
    sourceMedia.height ?? 1080
  );

  return {
    transcriptChunks: transcript.chunks,
    audioEvents: audio.events,
    visualEvents: visual.events,
    framesExtracted: visual.framesExtracted,
  };
}
