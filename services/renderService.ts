import path from "path";
import fs from "fs/promises";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { renderShort as ffmpegRender, isFfmpegAvailable, formatFfmpegProcessError } from "@/lib/ffmpeg";
import { generateSrt } from "@/lib/time";
import { formatCaptionTextForBurn } from "@/lib/captionStyles";
import { generateAss } from "@/lib/captionAss";
import { buildCaptionTrack, type CaptionWord } from "@/lib/captionTrack";
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
import {
  DEFAULT_CAPTION_APPEARANCE,
  normalizeCaptionAppearance,
} from "@/lib/captionAppearance";
import { readCaptionEdits } from "@/services/captionEditService";
import {
  appendRenderJobLog,
  makeRenderJobLogEntry,
  parseRenderJobLogs,
} from "@/lib/renderJobLogs";

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
  captionCues?: Array<{
    startTimeSeconds: number;
    endTimeSeconds: number;
    text: string;
    words?: CaptionWord[];
  }>;
}

export function parseRenderJobParams(value: unknown): RenderShortParams | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.streamSessionId !== "string" ||
    typeof raw.startTimeSeconds !== "number" ||
    typeof raw.endTimeSeconds !== "number"
  ) {
    return null;
  }
  return {
    streamSessionId: raw.streamSessionId,
    sourceMediaId:
      typeof raw.sourceMediaId === "string" ? raw.sourceMediaId : undefined,
    clipSuggestionId:
      typeof raw.clipSuggestionId === "string" ? raw.clipSuggestionId : undefined,
    startTimeSeconds: raw.startTimeSeconds,
    endTimeSeconds: raw.endTimeSeconds,
    format: raw.format === "native" ? "native" : "vertical",
    layout:
      raw.layout === "facecam_overlay" ||
      raw.layout === "facecam_top_gameplay_bottom" ||
      raw.layout === "gameplay_full"
        ? raw.layout
        : "center_crop",
    includeCaptions: Boolean(raw.includeCaptions),
    captionAppearance: normalizeCaptionAppearance(
      raw.captionAppearance as Partial<CaptionAppearance> | undefined
    ),
    captionCues: Array.isArray(raw.captionCues)
      ? (raw.captionCues as RenderShortParams["captionCues"])
      : undefined,
  };
}

async function updateJobProgress(jobId: string, progress: number, step?: string) {
  await prisma.renderJob.update({
    where: { id: jobId },
    data: { progress: Math.min(100, Math.max(0, Math.round(progress))) },
  });
  if (step) {
    await appendRenderJobLog(jobId, step, `Progress ${Math.round(progress)}%`);
  }
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
    captionCues: clientCaptionCues,
  } = params;

  const appearance = normalizeCaptionAppearance(captionAppearance);

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

  await updateJobProgress(jobId, 12, "prepare_source");

  const clipSource = await ensureClipSourceForRender(
    streamSessionId,
    startTimeSeconds,
    endTimeSeconds,
    sourceMediaId
  );

  await updateJobProgress(jobId, 25, "source_ready");

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
  let subtitlePath: string | undefined;
  const outputHeight =
    format === "vertical"
      ? Math.max(720, Number.parseInt(process.env.RENDER_VERTICAL_HEIGHT || "1920", 10) || 1920)
      : 1080;
  const outputWidth =
    format === "vertical" ? Math.round((outputHeight * 9) / 16) : 1920;

  if (includeCaptions) {
    await updateJobProgress(jobId, 35, "captions");
    const clientCues = (clientCaptionCues ?? []).filter(
      (cue) =>
        cue.startTimeSeconds <= endTimeSeconds &&
        cue.endTimeSeconds >= startTimeSeconds
    );
    const chunks = clientCues.length
      ? []
      : await getTranscriptChunksForRange(
          streamSessionId,
          startTimeSeconds,
          endTimeSeconds
        );
    if (clientCues.length > 0 || chunks.length > 0) {
      const captionEdits = await readCaptionEdits(streamSessionId);
      const captionLines = clientCues.length
        ? clientCues.map((cue, index) => ({
            ...cue,
            id: `client-${index}`,
            words: cue.words,
          }))
        : applyCaptionEdits(
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

      const shiftedCues = captionLines
        .map((c) => ({
          startTimeSeconds: Math.max(0, c.startTimeSeconds - startTimeSeconds),
          endTimeSeconds: Math.min(
            endTimeSeconds - startTimeSeconds,
            c.endTimeSeconds - startTimeSeconds
          ),
          text: formatCaptionTextForBurn(c.text, format),
          words: c.words
            ?.map((w) => ({
              start: Math.max(0, w.start - startTimeSeconds),
              end: Math.min(
                endTimeSeconds - startTimeSeconds,
                w.end - startTimeSeconds
              ),
              word: w.word,
            }))
            .filter((w) => w.end > w.start && w.word.trim().length > 0),
        }))
        .filter((cue) => cue.endTimeSeconds > cue.startTimeSeconds);

      if (shiftedCues.length === 0) {
        throw new Error("Captions are enabled, but no caption cues overlap this clip.");
      }

      try {
        const assContent = generateAss({
          cues: shiftedCues,
          appearance,
          width: outputWidth,
          height: outputHeight,
        });
        if (!assContent.trim()) {
          throw new Error("Empty ASS");
        }
        subtitlePath = path.join(rendersDir, `clip-${clipId}.ass`);
        await fs.writeFile(subtitlePath, assContent, "utf8");
      } catch {
        const srtContent = generateSrt(
          shiftedCues.map((c) => ({
            startTimeSeconds: c.startTimeSeconds,
            endTimeSeconds: c.endTimeSeconds,
            text: c.text,
          }))
        );
        if (!srtContent.trim()) {
          throw new Error("Captions are enabled, but no caption cues overlap this clip.");
        }
        subtitlePath = path.join(rendersDir, `clip-${clipId}.srt`);
        await fs.writeFile(subtitlePath, srtContent);
      }
    } else {
      throw new Error(
        "Captions are enabled, but transcription has not reached this clip yet. " +
          "Wait until captions appear in the selected timeline range, then render again."
      );
    }
  }

  const facecam =
    layout !== "center_crop"
      ? await prisma.facecamRegion.findFirst({
          where: { streamSessionId },
          orderBy: { confidence: "desc" },
        })
      : null;

  await appendRenderJobLog(jobId, "ffmpeg", "Encoding clip");
  await updateJobProgress(jobId, 55);

  await ffmpegRender({
    inputPath,
    outputPath,
    startTimeSeconds: renderStart,
    endTimeSeconds: renderEnd,
    format,
    layout,
    srtPath: subtitlePath,
    subtitleFormat: format,
    outputHeight,
    captionAppearance: appearance,
    facecamRegion: facecam
      ? {
          x: facecam.x,
          y: facecam.y,
          width: facecam.width,
          height: facecam.height,
        }
      : undefined,
  });

  const existing = await prisma.renderJob.findUnique({
    where: { id: jobId },
    select: { logs: true },
  });
  const logs = [
    ...parseRenderJobLogs(existing?.logs),
    makeRenderJobLogEntry("completed", "Render finished"),
  ];

  await prisma.renderJob.update({
    where: { id: jobId },
    data: {
      status: "completed",
      progress: 100,
      outputPath: relativeOutput,
      completedAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      errorMessage: null,
      logs: logs as unknown as Prisma.InputJsonValue,
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

/** Create a queued job row; worker executes later. */
export async function createRenderJobRecord(params: {
  streamSessionId: string;
  clipSuggestionId?: string;
  sourceMediaId?: string;
  layout?: string;
  includeCaptions?: boolean;
  renderParams: RenderShortParams;
  maxAttempts?: number;
}) {
  const job = await prisma.renderJob.create({
    data: {
      streamSessionId: params.streamSessionId,
      clipSuggestionId: params.clipSuggestionId,
      sourceMediaId: params.sourceMediaId,
      status: "queued",
      progress: 0,
      layout: params.layout ?? "center_crop",
      includeCaptions: params.includeCaptions ?? false,
      params: params.renderParams as unknown as Prisma.InputJsonValue,
      maxAttempts: params.maxAttempts ?? 3,
      logs: [
        makeRenderJobLogEntry("queued", "Render job queued"),
      ] as unknown as Prisma.InputJsonValue,
    },
  });
  return job.id;
}

export async function failRenderJob(jobId: string, message: string) {
  await appendRenderJobLog(jobId, "failed", message, "error");
  await prisma.renderJob.update({
    where: { id: jobId },
    data: {
      status: "failed",
      errorMessage: message.slice(0, 4000),
      progress: 0,
      completedAt: new Date(),
      lockedAt: null,
      lockedBy: null,
    },
  });
}

export async function waitForRenderJob(
  jobId: string,
  options: { timeoutMs?: number; pollMs?: number } = {}
): Promise<{ outputPath: string }> {
  const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000;
  const pollMs = options.pollMs ?? 1500;
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const job = await prisma.renderJob.findUnique({ where: { id: jobId } });
    if (!job) throw new Error("Render job not found");
    if (job.status === "completed" && job.outputPath) {
      return { outputPath: job.outputPath };
    }
    if (job.status === "failed") {
      throw new Error(job.errorMessage ?? "Render failed");
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error("Timed out waiting for render job");
}

/** Enqueue a render and wait for the background worker to finish. */
export async function renderShort(params: RenderShortParams) {
  const jobId = await createRenderJobRecord({
    streamSessionId: params.streamSessionId,
    clipSuggestionId: params.clipSuggestionId,
    sourceMediaId: params.sourceMediaId,
    layout: params.layout,
    includeCaptions: params.includeCaptions,
    renderParams: params,
  });

  try {
    // Kick the in-process worker if present; otherwise poll until another tick runs.
    const { runWorkerTick } = await import("@/services/workerService");
    void runWorkerTick().catch(() => {});
    const result = await waitForRenderJob(jobId);
    return { jobId, outputPath: result.outputPath };
  } catch (error) {
    const message = formatFfmpegProcessError(error);
    const job = await prisma.renderJob.findUnique({ where: { id: jobId } });
    if (job && job.status !== "failed" && job.status !== "completed") {
      await failRenderJob(jobId, message);
    }
    throw new Error(message);
  }
}

export async function getRenderJob(renderJobId: string) {
  return prisma.renderJob.findUnique({ where: { id: renderJobId } });
}
