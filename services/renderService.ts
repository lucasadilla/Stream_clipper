import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import { prisma } from "@/lib/db";
import { renderShort as ffmpegRender, isFfmpegAvailable, probeMedia } from "@/lib/ffmpeg";
import { generateSrt } from "@/lib/time";
import { formatCaptionTextForBurn } from "@/lib/captionStyles";
import { buildCaptionTrack } from "@/lib/captionTrack";
import { applyCaptionEdits } from "@/lib/captionEdits";
import {
  getRendersDir,
  ensureDir,
  resolveStoragePath,
  toRelativeStoragePath,
} from "@/lib/storage";
import { getTranscriptChunksForRange } from "@/services/transcriptService";
import { ensureClipSourceForRender } from "@/services/clipSourceService";
import type { RenderFormat } from "@/lib/renderFormat";
import type { CaptionAppearance } from "@/lib/captionAppearance";
import { DEFAULT_CAPTION_APPEARANCE } from "@/lib/captionAppearance";
import { readCaptionEdits } from "@/services/captionEditService";

export interface RenderShortParams {
  streamSessionId: string;
  sourceMediaId?: string;
  clipSuggestionId?: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  format?: RenderFormat;
  layout?: "center_crop" | "facecam_overlay" | "facecam_top_gameplay_bottom" | "gameplay_full";
  includeCaptions?: boolean;
  captionAppearance?: CaptionAppearance;
}

async function updateJobProgress(jobId: string, progress: number) {
  await prisma.renderJob.update({
    where: { id: jobId },
    data: { progress: Math.min(100, Math.max(0, Math.round(progress))) },
  });
}

/** Runs ffmpeg encode + writes output. Updates job progress along the way. */
export async function executeRenderJob(
  jobId: string,
  params: RenderShortParams
): Promise<{ outputPath: string }> {
  const {
    streamSessionId,
    sourceMediaId,
    clipSuggestionId,
    startTimeSeconds,
    endTimeSeconds,
    format = "vertical",
    layout = "center_crop",
    includeCaptions = true,
    captionAppearance = DEFAULT_CAPTION_APPEARANCE,
  } = params;

  const ffmpegOk = await isFfmpegAvailable();
  if (!ffmpegOk) {
    throw new Error(
      "FFmpeg is not installed. Install it (winget install Gyan.FFmpeg) and set FFMPEG_PATH in .env, then restart the dev server."
    );
  }

  const session = await prisma.streamSession.findUnique({
    where: { id: streamSessionId },
    include: { liveRecording: true },
  });
  if (!session) throw new Error("Session not found");

  await updateJobProgress(jobId, 12);

  const clipSource = await ensureClipSourceForRender(
    streamSessionId,
    startTimeSeconds,
    endTimeSeconds,
    sourceMediaId
  );

  await updateJobProgress(jobId, 28);

  const renderSource = await prisma.sourceMedia.findUnique({
    where: { id: clipSource.sourceMediaId },
  });
  if (!renderSource) throw new Error("Clip source not found");

  const renderStart = clipSource.renderStart;
  const renderEnd = clipSource.renderEnd;

  const clipId = clipSuggestionId ?? `custom-${Date.now()}`;
  const rendersDir = getRendersDir(streamSessionId);
  await ensureDir(rendersDir);

  const outputFilename = `clip-${clipId}-${format}.mp4`;
  const outputPath = path.join(rendersDir, outputFilename);
  const relativeOutput = toRelativeStoragePath(outputPath);

  const inputPath = resolveStoragePath(renderSource.filePath);
  let srtPath: string | undefined;
  let outputHeight = format === "vertical" ? 1920 : 1080;

  if (format === "native") {
    try {
      const probe = await probeMedia(inputPath);
      outputHeight = probe.height > 0 ? probe.height : 1080;
    } catch {
      outputHeight = 1080;
    }
  }

  if (includeCaptions) {
    await updateJobProgress(jobId, 35);
    const chunks = await getTranscriptChunksForRange(
      streamSessionId,
      startTimeSeconds,
      endTimeSeconds
    );
    if (chunks.length > 0) {
      const captionEdits = await readCaptionEdits(streamSessionId);
      const captionLines = applyCaptionEdits(
        buildCaptionTrack(
          chunks
            .filter((c) => c.text.trim().length > 0)
            .map((c) => ({
              id: c.id ?? `chunk-${c.startTimeSeconds}`,
              startTimeSeconds: c.startTimeSeconds,
              endTimeSeconds: c.endTimeSeconds,
              text: c.text,
              rawJson: c.rawJson,
            })),
          format
        ),
        captionEdits
      );
      const srtContent = generateSrt(
        captionLines.map((c) => ({
          startTimeSeconds: Math.max(0, c.startTimeSeconds - startTimeSeconds),
          endTimeSeconds: c.endTimeSeconds - startTimeSeconds,
          text: formatCaptionTextForBurn(c.text, format),
        }))
      );
      srtPath = path.join(rendersDir, `clip-${clipId}.srt`);
      await fs.writeFile(srtPath, srtContent);
    }
  }

  await updateJobProgress(jobId, 45);

  const facecam = await prisma.facecamRegion.findFirst({
    where: { streamSessionId },
    orderBy: { confidence: "desc" },
  });

  await ffmpegRender({
    inputPath,
    outputPath,
    startTimeSeconds: renderStart,
    endTimeSeconds: renderEnd,
    format,
    layout,
    srtPath,
    subtitleFormat: format,
    outputHeight,
    captionAppearance,
    facecamRegion: facecam
      ? {
          x: facecam.x,
          y: facecam.y,
          width: facecam.width,
          height: facecam.height,
        }
      : undefined,
  });

  await prisma.renderJob.update({
    where: { id: jobId },
    data: {
      status: "completed",
      progress: 100,
      outputPath: relativeOutput,
    },
  });

  if (clipSuggestionId) {
    await prisma.clipSuggestion.update({
      where: { id: clipSuggestionId },
      data: { status: "rendered" },
    });
  }

  return { outputPath: relativeOutput };
}

/** Create job row and return id (work continues via executeRenderJob). */
export async function createRenderJobRecord(params: {
  streamSessionId: string;
  clipSuggestionId?: string;
  sourceMediaId?: string;
  layout?: string;
  includeCaptions?: boolean;
}) {
  const job = await prisma.renderJob.create({
    data: {
      streamSessionId: params.streamSessionId,
      clipSuggestionId: params.clipSuggestionId,
      sourceMediaId: params.sourceMediaId,
      status: "processing",
      progress: 5,
      layout: params.layout ?? "center_crop",
      includeCaptions: params.includeCaptions ?? false,
    },
  });
  return job.id;
}

export async function failRenderJob(jobId: string, message: string) {
  await prisma.renderJob.update({
    where: { id: jobId },
    data: { status: "failed", errorMessage: message, progress: 0 },
  });
}

/** Synchronous render (used by tests or direct calls). */
export async function renderShort(params: RenderShortParams) {
  const jobId = await createRenderJobRecord({
    streamSessionId: params.streamSessionId,
    clipSuggestionId: params.clipSuggestionId,
    sourceMediaId: params.sourceMediaId,
    layout: params.layout,
    includeCaptions: params.includeCaptions,
  });

  try {
    const result = await executeRenderJob(jobId, params);
    return { jobId, outputPath: result.outputPath };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failRenderJob(jobId, message);
    throw error;
  }
}

export async function getRenderJob(renderJobId: string) {
  return prisma.renderJob.findUnique({ where: { id: renderJobId } });
}
