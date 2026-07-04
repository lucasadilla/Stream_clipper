import path from "path";
import fs from "fs/promises";
import { prisma } from "@/lib/db";
import { renderShort as ffmpegRender, isFfmpegAvailable, probeMedia } from "@/lib/ffmpeg";
import { generateSrt } from "@/lib/time";
import { formatCaptionTextForBurn } from "@/lib/captionStyles";
import { buildCaptionTrack } from "@/lib/captionTrack";
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

export async function renderShort(params: RenderShortParams) {
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
  });
  if (!session) throw new Error("Session not found");

  const clipSource = await ensureClipSourceForRender(
    streamSessionId,
    startTimeSeconds,
    endTimeSeconds,
    sourceMediaId
  );

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

  const job = await prisma.renderJob.create({
    data: {
      streamSessionId,
      clipSuggestionId,
      sourceMediaId: clipSource.sourceMediaId,
      status: "processing",
      progress: 10,
      layout,
      includeCaptions,
    },
  });

  try {
    await prisma.renderJob.update({
      where: { id: job.id },
      data: { progress: 20 },
    });

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
      const chunks = await getTranscriptChunksForRange(
        streamSessionId,
        startTimeSeconds,
        endTimeSeconds
      );
      if (chunks.length > 0) {
        const captionLines = buildCaptionTrack(
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

    await prisma.renderJob.update({
      where: { id: job.id },
      data: { progress: 40 },
    });

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
      where: { id: job.id },
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

    return { jobId: job.id, outputPath: relativeOutput };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.renderJob.update({
      where: { id: job.id },
      data: { status: "failed", errorMessage: message, progress: 0 },
    });
    throw error;
  }
}

export async function getRenderJob(renderJobId: string) {
  return prisma.renderJob.findUnique({ where: { id: renderJobId } });
}
