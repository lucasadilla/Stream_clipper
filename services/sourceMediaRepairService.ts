import path from "path";
import { stat } from "fs/promises";
import { prisma } from "@/lib/db";
import { probeMedia } from "@/lib/ffmpeg";
import {
  fileExists,
  findBestSourceFileInDir,
  getUploadDir,
  resolveStoragePath,
  toRelativeStoragePath,
} from "@/lib/storage";
import { toJsonValue } from "@/lib/utils";

async function sourceMediaFromFoundFile(streamSessionId: string, absolutePath: string) {
  const relativePath = toRelativeStoragePath(absolutePath);
  const existing = await prisma.sourceMedia.findFirst({
    where: { streamSessionId, filePath: relativePath },
    orderBy: { createdAt: "desc" },
  });

  const fileStat = await stat(absolutePath);
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

  const ext = path.extname(absolutePath).toLowerCase();
  if (existing) {
    return prisma.sourceMedia.update({
      where: { id: existing.id },
      data: {
        sizeBytes: BigInt(fileStat.size),
        durationSeconds: probe.durationSeconds || existing.durationSeconds,
        width: probe.width || existing.width,
        height: probe.height || existing.height,
        fps: probe.fps || existing.fps,
        codecInfo:
          Object.keys(probe.raw).length > 0
            ? toJsonValue(probe.raw)
            : existing.codecInfo ?? undefined,
      },
    });
  }
  return prisma.sourceMedia.create({
    data: {
      streamSessionId,
      originalFilename: path.basename(absolutePath),
      filePath: relativePath,
      mimeType: ext === ".mkv" ? "video/x-matroska" : "video/mp4",
      sizeBytes: BigInt(fileStat.size),
      durationSeconds: probe.durationSeconds || null,
      width: probe.width || null,
      height: probe.height || null,
      fps: probe.fps || null,
      codecInfo: toJsonValue(probe.raw),
      isLiveRecording: /^source\.mkv$/i.test(path.basename(absolutePath)),
    },
  });
}

export async function findLocalSourceMedia(streamSessionId: string) {
  const sourceMedia = await prisma.sourceMedia.findFirst({
    where: { streamSessionId },
    orderBy: { createdAt: "desc" },
  });
  if (sourceMedia?.filePath && fileExists(sourceMedia.filePath)) {
    if ((sourceMedia.durationSeconds ?? 0) >= 2) return sourceMedia;
    return sourceMediaFromFoundFile(
      streamSessionId,
      resolveStoragePath(sourceMedia.filePath)
    );
  }

  const found = await findBestSourceFileInDir(getUploadDir(streamSessionId));
  if (!found) return null;

  const repaired = await sourceMediaFromFoundFile(streamSessionId, found);
  if (sourceMedia && sourceMedia.id !== repaired.id) {
    await prisma.sourceMedia.deleteMany({
      where: {
        streamSessionId,
        id: sourceMedia.id,
      },
    });
  }
  return repaired;
}

export async function ensureLocalSourceMedia(streamSessionId: string) {
  const local = await findLocalSourceMedia(streamSessionId);
  if (local) return local;

  const { acquireSourceMedia } = await import("@/services/liveRecordingService");
  const result = await acquireSourceMedia(streamSessionId);
  const media = result.sourceMedia;
  if (media?.filePath && fileExists(media.filePath)) {
    return media;
  }

  return findLocalSourceMedia(streamSessionId);
}
