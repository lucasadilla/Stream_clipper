import path from "path";
import { createWriteStream } from "fs";
import { randomUUID } from "crypto";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";
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
  fileExists,
  listSourceCandidateFiles,
} from "@/lib/storage";
import {
  ensureLocalSourceMedia,
  findLocalSourceMedia,
} from "@/services/sourceMediaRepairService";
import { resolveSourceRecordedSeconds, canAttemptTranscription } from "@/services/liveRecordingService";

const MIN_SEGMENT_SECONDS = 3;

export async function saveSourceMedia(
  streamSessionId: string,
  file: File,
  options?: { maxDurationSeconds?: number | null }
) {
  return saveSourceMediaStream(
    streamSessionId,
    {
      name: file.name,
      type: file.type,
      stream: file.stream(),
    },
    options
  );
}

export async function saveSourceMediaStream(
  streamSessionId: string,
  file: {
    name: string;
    type: string;
    stream: ReadableStream<Uint8Array>;
  },
  options?: { maxDurationSeconds?: number | null }
) {
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
  const temporaryPath = path.join(
    uploadDir,
    `.source-upload-${randomUUID()}${ext}`
  );
  const maxBytes = Number.parseInt(
    process.env.MAX_SOURCE_UPLOAD_BYTES?.trim() ?? "",
    10
  ) || 12 * 1024 * 1024 * 1024;
  let sizeBytes = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      sizeBytes += chunk.length;
      if (sizeBytes > maxBytes) {
        callback(new Error("Source video is too large for this deployment."));
        return;
      }
      callback(null, chunk);
    },
  });

  try {
    await pipeline(
      Readable.fromWeb(file.stream as import("stream/web").ReadableStream),
      meter,
      createWriteStream(temporaryPath, { mode: 0o600 })
    );
  } catch (error) {
    await fsUnlink(temporaryPath);
    throw error;
  }

  let probe;
  try {
    probe = await probeMedia(temporaryPath);
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

  if (
    options?.maxDurationSeconds &&
    probe.durationSeconds > options.maxDurationSeconds
  ) {
    await fsUnlink(temporaryPath);
    throw new Error("Creator Beta source videos can be up to 3 hours long.");
  }

  const { rename } = await import("fs/promises");
  await fsUnlink(absolutePath);
  await rename(temporaryPath, absolutePath);
  const relativePath = toRelativeStoragePath(absolutePath);

  const sourceMedia = await prisma.$transaction(async (tx) => {
    await tx.sourceMedia.deleteMany({ where: { streamSessionId } });
    return tx.sourceMedia.create({
      data: {
        streamSessionId,
        originalFilename: file.name,
        filePath: relativePath,
        mimeType: file.type || "video/mp4",
        sizeBytes: BigInt(sizeBytes),
        durationSeconds: probe.durationSeconds || null,
        width: probe.width || null,
        height: probe.height || null,
        fps: probe.fps || null,
        codecInfo: toJsonValue(probe.raw),
        isLiveRecording: false,
      },
    });
  });

  const staleSourceFiles = await listSourceCandidateFiles(uploadDir);
  await Promise.all(
    staleSourceFiles
      .filter((candidate) => path.resolve(candidate) !== path.resolve(absolutePath))
      .map(fsUnlink)
  );

  return sourceMedia;
}

async function fsUnlink(filePath: string): Promise<void> {
  const { unlink } = await import("fs/promises");
  await unlink(filePath).catch(() => {});
}

export async function processVideoIncremental(streamSessionId: string) {
  const sourceMedia = await findLocalSourceMedia(streamSessionId);
  if (!sourceMedia) return { skipped: true, reason: "no_media" };

  const recorded = await resolveSourceRecordedSeconds(streamSessionId);
  if (!(await canAttemptTranscription(streamSessionId))) {
    return { skipped: true, reason: "too_short" };
  }

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
  const sourceMedia = await ensureLocalSourceMedia(streamSessionId);
  if (!sourceMedia?.filePath || !fileExists(sourceMedia.filePath)) {
    throw new Error(
      "Source video not ready. Download or record the source again before processing."
    );
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
