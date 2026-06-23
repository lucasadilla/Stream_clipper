import path from "path";
import { toJsonValue } from "@/lib/utils";
import { prisma } from "@/lib/db";
import { probeMedia } from "@/lib/ffmpeg";
import {
  getUploadDir,
  ensureDir,
  toRelativeStoragePath,
  isAllowedVideoFile,
} from "@/lib/storage";

export async function saveSourceMedia(
  streamSessionId: string,
  file: File
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

  // Remove previous source media records
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
  if (recorded < 25) return { skipped: true, reason: "too_short" };

  const lastChunk = await prisma.transcriptChunk.findFirst({
    where: { streamSessionId },
    orderBy: { endTimeSeconds: "desc" },
  });
  const fromSeconds = lastChunk?.endTimeSeconds ?? 0;
  if (recorded - fromSeconds < 20) {
    return { skipped: true, reason: "already_processed" };
  }

  const segmentEnd = Math.min(fromSeconds + 30, recorded);
  const segments = [
    {
      startTimeSeconds: fromSeconds,
      endTimeSeconds: segmentEnd,
      text: `[Live transcript ${Math.floor(fromSeconds)}s–${Math.floor(segmentEnd)}s]`,
    },
  ];

  const { createEmbedding } = await import("@/lib/embeddings");
  const { storeEmbedding } = await import("@/lib/rag");

  for (const seg of segments) {
    const chunk = await prisma.transcriptChunk.create({
      data: {
        streamSessionId,
        startTimeSeconds: seg.startTimeSeconds,
        endTimeSeconds: seg.endTimeSeconds,
        text: seg.text,
        rawJson: toJsonValue({ live: true, segment: true }),
      },
    });

    try {
      const embedding = await createEmbedding(seg.text);
      await storeEmbedding("TranscriptChunk", chunk.id, embedding);
    } catch {
      // embeddings optional during live
    }
  }

  const { analyzeAudioSegment } = await import("@/services/audioAnalysisService");
  await analyzeAudioSegment(
    streamSessionId,
    sourceMedia.filePath,
    fromSeconds,
    segmentEnd
  );

  return {
    skipped: false,
    transcriptChunks: 1,
    fromSeconds,
    toSeconds: segmentEnd,
  };
}

export async function processVideo(streamSessionId: string) {
  const sourceMedia = await prisma.sourceMedia.findFirst({
    where: { streamSessionId },
    orderBy: { createdAt: "desc" },
  });
  if (!sourceMedia) {
    throw new Error(
      "Source video not ready. Wait for YouTube download to finish or click Download from YouTube."
    );
  }

  const { generateTranscript } = await import("@/services/transcriptService");
  const { analyzeAudio } = await import("@/services/audioAnalysisService");
  const { analyzeVisual } = await import("@/services/visualAnalysisService");
  const { detectFacecamRegion } = await import("@/services/facecamDetectionService");
  const { getFramesDir } = await import("@/lib/storage");
  const { extractFrames } = await import("@/lib/ffmpeg");
  const { resolveStoragePath } = await import("@/lib/storage");

  const transcript = await generateTranscript(
    streamSessionId,
    sourceMedia.filePath
  );
  const audio = await analyzeAudio(streamSessionId, sourceMedia.filePath);
  const visual = await analyzeVisual(streamSessionId, sourceMedia.filePath);

  // Facecam detection on extracted frames
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
