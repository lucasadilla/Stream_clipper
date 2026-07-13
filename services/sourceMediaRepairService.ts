import path from "path";
import { stat } from "fs/promises";
import { prisma } from "@/lib/db";
import { hasVideoStream, probeMedia } from "@/lib/ffmpeg";
import {
  fileExists,
  findBestSourceFileInDir,
  getUploadDir,
  resolveStoragePath,
  toRelativeStoragePath,
} from "@/lib/storage";
import { toJsonValue } from "@/lib/utils";

async function sourceMediaFromFoundFile(
  streamSessionId: string,
  absolutePath: string,
  sourceMediaId?: string
) {
  const relativePath = toRelativeStoragePath(absolutePath);
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
  const data = {
    originalFilename: path.basename(absolutePath),
    filePath: relativePath,
    mimeType: ext === ".mkv" ? "video/x-matroska" : "video/mp4",
    sizeBytes: BigInt(fileStat.size),
    durationSeconds: probe.durationSeconds || null,
    width: probe.width || null,
    height: probe.height || null,
    fps: probe.fps || null,
    codecInfo: toJsonValue(probe.raw),
    isLiveRecording: /^source(?:\.f\d+)?\.mkv$/i.test(
      path.basename(absolutePath)
    ),
  };

  const existing = sourceMediaId
    ? await prisma.sourceMedia.findUnique({ where: { id: sourceMediaId } })
    : await prisma.sourceMedia.findFirst({
        where: { streamSessionId, filePath: relativePath },
        orderBy: { createdAt: "desc" },
      });

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

export async function findLocalSourceMedia(streamSessionId: string) {
  const sourceMedia = await prisma.sourceMedia.findFirst({
    where: { streamSessionId },
    orderBy: { createdAt: "desc" },
  });
  if (sourceMedia?.filePath && fileExists(sourceMedia.filePath)) {
    const absolutePath = resolveStoragePath(sourceMedia.filePath);
    if ((sourceMedia.width ?? 0) > 0) {
      return sourceMedia;
    }
    if (await hasVideoStream(absolutePath)) {
      return sourceMediaFromFoundFile(
        streamSessionId,
        absolutePath,
        sourceMedia.id
      );
    }
  }

  const found = await findBestSourceFileInDir(getUploadDir(streamSessionId));
  if (!found) return null;

  return sourceMediaFromFoundFile(streamSessionId, found, sourceMedia?.id);
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
