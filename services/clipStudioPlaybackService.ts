import path from "path";
import { existsSync } from "fs";
import { rename, stat, unlink } from "fs/promises";
import { prisma } from "@/lib/db";
import {
  canDecodeVideoFrame,
  getFfmpegPath,
  getFfmpegThreadCount,
  probeMedia,
  runCommand,
} from "@/lib/ffmpeg";
import {
  ensureDir,
  getUploadDir,
  resolveStoragePath,
  toRelativeStoragePath,
} from "@/lib/storage";
import { ensureClipSourceForRender } from "@/services/clipSourceService";
import { mediaCoversTimelineRange } from "@/lib/clipPlaybackTime";

export interface ClipStudioPlaybackSource {
  relativePath: string;
  timelineOffsetSeconds: number;
  durationSeconds: number;
  version: number;
}

const inFlight = new Map<string, Promise<ClipStudioPlaybackSource>>();

export class ClipStudioPlaybackNotReadyError extends Error {
  readonly retryAfterMs = 2500;

  constructor() {
    super("The live video buffer is still catching up to this clip.");
    this.name = "ClipStudioPlaybackNotReadyError";
  }
}

function rangeToken(value: number): string {
  return String(Math.max(0, Math.round(value * 1000)));
}

async function buildClipStudioPlayback(
  clip: {
    id: string;
    streamSessionId: string;
    startTimeSeconds: number;
    endTimeSeconds: number;
  }
): Promise<ClipStudioPlaybackSource> {
  const source = await ensureClipSourceForRender(
    clip.streamSessionId,
    clip.startTimeSeconds,
    clip.endTimeSeconds,
    undefined,
    { purpose: "preview" }
  );
  const sourceMedia = await prisma.sourceMedia.findUnique({
    where: { id: source.sourceMediaId },
    select: { filePath: true },
  });
  if (!sourceMedia) throw new Error("Clip preview source was not found");

  const inputPath = resolveStoragePath(sourceMedia.filePath);
  if (!existsSync(inputPath)) throw new Error("Clip preview source is missing");

  const duration = Math.max(0.1, source.renderEnd - source.renderStart);
  const requestedDuration = clip.endTimeSeconds - clip.startTimeSeconds;
  if (duration < requestedDuration - 0.5) {
    throw new ClipStudioPlaybackNotReadyError();
  }
  const fileName = `studio-preview-${clip.id}-${rangeToken(
    clip.startTimeSeconds
  )}-${rangeToken(clip.endTimeSeconds)}.mp4`;
  const outputPath = path.join(getUploadDir(clip.streamSessionId), fileName);
  const relativePath = toRelativeStoragePath(outputPath);

  if (existsSync(outputPath)) {
    try {
      const [probe, fileStat, decodable] = await Promise.all([
        probeMedia(outputPath),
        stat(outputPath),
        canDecodeVideoFrame(outputPath),
      ]);
      if (
        probe.videoCodec &&
        decodable &&
        mediaCoversTimelineRange({
          mediaDurationSeconds: probe.durationSeconds,
          timelineOffsetSeconds: clip.startTimeSeconds,
          rangeStartSeconds: clip.startTimeSeconds,
          rangeEndSeconds: clip.endTimeSeconds,
        })
      ) {
        return {
          relativePath,
          timelineOffsetSeconds: clip.startTimeSeconds,
          durationSeconds: probe.durationSeconds,
          version: Math.floor(fileStat.mtimeMs),
        };
      }
    } catch {
      // Replace a partial cache atomically below.
    }
  }

  await ensureDir(path.dirname(outputPath));
  const tempPath = `${outputPath}.${process.pid}-${Date.now()}.tmp.mp4`;
  try {
    await runCommand(
      getFfmpegPath(),
      [
        "-y",
        "-nostdin",
        "-loglevel",
        "error",
        "-ss",
        String(Math.max(0, source.renderStart)),
        "-i",
        inputPath,
        "-t",
        String(duration),
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        "-vf",
        "scale=960:720:force_original_aspect_ratio=decrease:flags=fast_bilinear,setsar=1",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-crf",
        "27",
        "-pix_fmt",
        "yuv420p",
        "-threads",
        String(getFfmpegThreadCount()),
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-avoid_negative_ts",
        "make_zero",
        "-movflags",
        "+faststart",
        tempPath,
      ],
      { timeoutMs: 90_000 }
    );

    const probe = await probeMedia(tempPath);
    if (
      !probe.videoCodec ||
      !(await canDecodeVideoFrame(tempPath)) ||
      !mediaCoversTimelineRange({
        mediaDurationSeconds: probe.durationSeconds,
        timelineOffsetSeconds: clip.startTimeSeconds,
        rangeStartSeconds: clip.startTimeSeconds,
        rangeEndSeconds: clip.endTimeSeconds,
      })
    ) {
      if (probe.videoCodec) throw new ClipStudioPlaybackNotReadyError();
      throw new Error("Clip preview did not contain decodable video");
    }
    await unlink(outputPath).catch(() => {});
    await rename(tempPath, outputPath);
    const fileStat = await stat(outputPath);
    return {
      relativePath,
      // FFmpeg cuts a new file beginning at media time zero, whose first frame
      // represents the absolute start of this suggested clip.
      timelineOffsetSeconds: clip.startTimeSeconds,
      durationSeconds: probe.durationSeconds,
      version: Math.floor(fileStat.mtimeMs),
    };
  } finally {
    await unlink(tempPath).catch(() => {});
  }
}

export async function ensureClipStudioPlayback(
  clipSuggestionId: string,
  requestedRange?: {
    startTimeSeconds: number;
    endTimeSeconds: number;
  }
): Promise<ClipStudioPlaybackSource> {
  const savedClip = await prisma.clipSuggestion.findUnique({
    where: { id: clipSuggestionId },
    select: {
      id: true,
      streamSessionId: true,
      startTimeSeconds: true,
      endTimeSeconds: true,
    },
  });
  if (!savedClip) throw new Error("Clip not found");
  const clip = requestedRange
    ? {
        ...savedClip,
        startTimeSeconds: requestedRange.startTimeSeconds,
        endTimeSeconds: requestedRange.endTimeSeconds,
      }
    : savedClip;

  // Retrimming can happen while the previous preview is still encoding. Keep
  // the range in the key so a longer trim cannot reuse a physically shorter MP4.
  const requestKey = `${clip.id}:${rangeToken(
    clip.startTimeSeconds
  )}:${rangeToken(clip.endTimeSeconds)}`;
  const existing = inFlight.get(requestKey);
  if (existing) return existing;

  const pending = buildClipStudioPlayback(clip);
  inFlight.set(requestKey, pending);
  try {
    return await pending;
  } finally {
    if (inFlight.get(requestKey) === pending) {
      inFlight.delete(requestKey);
    }
  }
}
