import path from "path";
import fs from "fs/promises";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  renderShort as ffmpegRender,
  renderSequence as ffmpegRenderSequence,
  isFfmpegAvailable,
  formatFfmpegProcessError,
} from "@/lib/ffmpeg";
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
import {
  isNoSpaceError,
  noSpaceLeftError,
  reclaimEphemeralStorage,
} from "@/services/storageReclaimService";
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
import {
  normalizeEditorState,
  outputTimeForSegment,
  segmentDuration,
  sequenceBounds,
  type EditorSegment,
  type EditorOverlay,
  type EditorState,
} from "@/lib/editorState";
import {
  captionSafeZoneForLayout,
  parseVerticalLayoutRequest,
  type VerticalLayoutRequest,
} from "@/lib/verticalLayout";
import { resolveVerticalLayout } from "@/services/verticalLayoutService";

const PREVIEW_MAX_SECONDS = 5;
const PREVIEW_HEIGHT = 640;

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
  editorState?: EditorState;
  /** Facecam-aware vertical layout selection (validated client request). */
  verticalLayout?: VerticalLayoutRequest;
  /** Render a short low-resolution preview instead of the final export. */
  preview?: boolean;
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
    editorState: normalizeEditorState(raw.editorState),
    verticalLayout: parseVerticalLayoutRequest(raw.verticalLayout) ?? undefined,
    preview: raw.preview === true,
  };
}

type BurnCaptionCue = {
  startTimeSeconds: number;
  endTimeSeconds: number;
  text: string;
  words?: CaptionWord[];
};

function mapCaptionsToSequence(
  cues: BurnCaptionCue[],
  segments: EditorSegment[],
  format: RenderFormat
): BurnCaptionCue[] {
  const mapped: BurnCaptionCue[] = [];
  let outputOffset = 0;
  for (const segment of segments) {
    for (const cue of cues) {
      const overlapStart = Math.max(cue.startTimeSeconds, segment.sourceStart);
      const overlapEnd = Math.min(cue.endTimeSeconds, segment.sourceEnd);
      if (overlapEnd <= overlapStart) continue;
      const words = cue.words
        ?.filter((word) => word.end > overlapStart && word.start < overlapEnd)
        .map((word) => ({
          start: outputOffset + Math.max(0, word.start - segment.sourceStart),
          end:
            outputOffset +
            Math.min(segmentDuration(segment), word.end - segment.sourceStart),
          word: word.word,
        }))
        .filter((word) => word.end > word.start && word.word.trim().length > 0);
      mapped.push({
        startTimeSeconds:
          outputOffset + Math.max(0, overlapStart - segment.sourceStart),
        endTimeSeconds:
          outputOffset + Math.min(segmentDuration(segment), overlapEnd - segment.sourceStart),
        text: formatCaptionTextForBurn(cue.text, format),
        ...(words?.length ? { words } : {}),
      });
    }
    outputOffset += segmentDuration(segment);
  }
  return mapped;
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
    editorState: rawEditorState,
    verticalLayout: verticalLayoutRequest,
    preview = false,
  } = params;

  let appearance = normalizeCaptionAppearance(captionAppearance);
  // Previews always render as a single short cut, never a full sequence.
  const editorState = preview
    ? normalizeEditorState(undefined)
    : normalizeEditorState(rawEditorState);
  const sequenceSegments = editorState.segments;
  const bounds = preview ? null : sequenceBounds(normalizeEditorState(rawEditorState).segments);
  const effectiveStart = bounds?.start ?? startTimeSeconds;
  let effectiveEnd = bounds?.end ?? endTimeSeconds;
  if (preview) {
    effectiveEnd = Math.min(effectiveEnd, effectiveStart + PREVIEW_MAX_SECONDS);
  }

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

  // Free temp/replaced-session media before mux + encode (Railway volumes fill fast).
  await reclaimEphemeralStorage({
    keepSessionId: streamSessionId,
    pruneSessionSegments: true,
  }).catch((err) => {
    console.warn("[render] storage reclaim skipped:", err);
  });

  let clipSource;
  try {
    clipSource = await ensureClipSourceForRender(
      streamSessionId,
      effectiveStart,
      effectiveEnd,
      sourceMediaId
    );
  } catch (error) {
    if (isNoSpaceError(error)) throw noSpaceLeftError();
    throw error;
  }

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

  const outputFilename = preview
    ? `clip-${clipId}-preview-${jobId.slice(-8)}.mp4`
    : `clip-${clipId}-${format}.mp4`;
  const outputPath = path.join(rendersDir, outputFilename);
  const relativeOutput = toRelativeStoragePath(outputPath);

  const inputPath = resolveStoragePath(renderSource.filePath);
  let subtitlePath: string | undefined;
  const outputHeight = preview
    ? PREVIEW_HEIGHT
    : format === "vertical"
      ? Math.max(720, Number.parseInt(process.env.RENDER_VERTICAL_HEIGHT || "1920", 10) || 1920)
      : 1080;
  const outputWidth =
    format === "vertical"
      ? Math.round((outputHeight * 9) / 16)
      : preview
        ? Math.round((outputHeight * 16) / 9)
        : 1920;

  // Resolve the facecam-aware vertical layout (auto recommendation, manual
  // rect, candidate selection). Falls back to center crop internally, so a
  // failed or missing face analysis can never block the export.
  let resolvedVerticalLayout:
    | Awaited<ReturnType<typeof resolveVerticalLayout>>
    | null = null;
  if (format === "vertical" && verticalLayoutRequest) {
    try {
      resolvedVerticalLayout = await resolveVerticalLayout(verticalLayoutRequest, {
        streamSessionId,
        clipStartSeconds: effectiveStart,
        clipEndSeconds: effectiveEnd,
        outputWidth,
        outputHeight,
      });
      await appendRenderJobLog(
        jobId,
        "vertical_layout",
        `Layout: ${resolvedVerticalLayout.effectiveLayout}` +
          (resolvedVerticalLayout.warnings.length
            ? ` (${resolvedVerticalLayout.warnings.join(" ")})`
            : "")
      );
      // Move captions into the layout's safe zone so they never cover the
      // facecam panel or PiP window.
      const safeZone = captionSafeZoneForLayout({
        layout: resolvedVerticalLayout.effectiveLayout,
        captionPosition: verticalLayoutRequest.captions?.position,
        stackedFacecamPosition:
          resolvedVerticalLayout.resolved.stacked?.facecamPosition,
        stackedFacecamHeightRatio:
          resolvedVerticalLayout.resolved.stacked?.facecamHeightRatio,
        pipPosition: resolvedVerticalLayout.resolved.pip?.position,
      });
      appearance = {
        ...appearance,
        vertical: safeZone.vertical,
        verticalOffsetPercent: safeZone.verticalOffsetPercent,
      };
    } catch (error) {
      await appendRenderJobLog(
        jobId,
        "vertical_layout",
        `Layout resolution failed, using center crop: ${
          error instanceof Error ? error.message : String(error)
        }`,
        "warn"
      );
      resolvedVerticalLayout = null;
    }
  }

  const textOverlays = editorState.overlays.filter(
    (
      overlay
    ): overlay is EditorOverlay & { type: "text" | "lower-third" } =>
      overlay.type === "text" || overlay.type === "lower-third"
  );

  const hasMediaOverlays = editorState.overlays.some(
    (overlay) => overlay.type === "image" || overlay.type === "broll"
  );
  const canStreamCopy =
    format === "native" &&
    !includeCaptions &&
    textOverlays.length === 0 &&
    !hasMediaOverlays &&
    !editorState.settings.normalizeAudio &&
    !editorState.settings.denoiseAudio &&
    sequenceSegments.length <= 1;

  // Fast path: skip ASS/transcript prep and cut with stream copy.
  if (canStreamCopy) {
    await appendRenderJobLog(jobId, "ffmpeg", "Stream copy (no re-encode)");
    await updateJobProgress(jobId, 55, "cutting");
    const seg = sequenceSegments[0];
    const cutStart = seg
      ? renderStart + (seg.sourceStart - effectiveStart)
      : renderStart;
    const cutEnd = seg
      ? renderStart + (seg.sourceEnd - effectiveStart)
      : renderEnd;

    // Muxed segment-* files are already the requested range — avoid a second
    // ffmpeg pass when the cut is essentially the whole file.
    const alreadyCut =
      cutStart < 0.05 &&
      path.basename(inputPath).toLowerCase().startsWith("segment-");
    if (alreadyCut) {
      await fs.copyFile(inputPath, outputPath);
    } else {
      await ffmpegRender({
        inputPath,
        outputPath,
        startTimeSeconds: cutStart,
        endTimeSeconds: cutEnd,
        format: "native",
        layout: "center_crop",
        outputHeight: 1080,
      });
    }

    await updateJobProgress(jobId, 90, "finalizing");

    const existing = await prisma.renderJob.findUnique({
      where: { id: jobId },
      select: { logs: true },
    });
    const logs = [
      ...parseRenderJobLogs(existing?.logs),
      makeRenderJobLogEntry("completed", "Stream copy finished"),
    ];

    await prisma.renderJob.update({
      where: { id: jobId },
      data: {
        status: "completed",
        progress: 100,
        outputPath: relativeOutput,
        logs: logs as unknown as Prisma.InputJsonValue,
        completedAt: new Date(),
        errorMessage: null,
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

  if (includeCaptions || textOverlays.length > 0) {
    await updateJobProgress(jobId, 35, "captions");
    const clientCues = (clientCaptionCues ?? []).filter(
      (cue) => {
        if (sequenceSegments.length === 0) {
          return (
            cue.startTimeSeconds <= effectiveEnd &&
            cue.endTimeSeconds >= effectiveStart
          );
        }
        return sequenceSegments.some(
          (segment) =>
            cue.startTimeSeconds <= segment.sourceEnd &&
            cue.endTimeSeconds >= segment.sourceStart
        );
      }
    );
    const chunks = !includeCaptions || clientCues.length
      ? []
      : await getTranscriptChunksForRange(
          streamSessionId,
          effectiveStart,
          effectiveEnd
        );
    if (!includeCaptions || clientCues.length > 0 || chunks.length > 0) {
      const captionEdits = await readCaptionEdits(streamSessionId);
      const captionLines: BurnCaptionCue[] = !includeCaptions
        ? []
        : clientCues.length
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

      const shiftedCues = sequenceSegments.length
        ? mapCaptionsToSequence(captionLines, sequenceSegments, format)
        : captionLines
            .map((cue) => ({
              startTimeSeconds: Math.max(0, cue.startTimeSeconds - effectiveStart),
              endTimeSeconds: Math.min(
                effectiveEnd - effectiveStart,
                cue.endTimeSeconds - effectiveStart
              ),
              text: formatCaptionTextForBurn(cue.text, format),
              words: cue.words
                ?.map((word) => ({
                  start: Math.max(0, word.start - effectiveStart),
                  end: Math.min(effectiveEnd - effectiveStart, word.end - effectiveStart),
                  word: word.word,
                }))
                .filter((word) => word.end > word.start && word.word.trim().length > 0),
            }))
            .filter((cue) => cue.endTimeSeconds > cue.startTimeSeconds);

      if (includeCaptions && shiftedCues.length === 0 && !preview) {
        throw new Error("Captions are enabled, but no caption cues overlap this clip.");
      }

      const overlayCues = textOverlays.flatMap((overlay) => {
        const segment = sequenceSegments.find((item) => item.id === overlay.segmentId);
        if (!segment || !overlay.text?.trim()) return [];
        return [
          {
            startTimeSeconds: outputTimeForSegment(
              sequenceSegments,
              segment.id,
              overlay.startOffsetSeconds
            ),
            endTimeSeconds: outputTimeForSegment(
              sequenceSegments,
              segment.id,
              Math.min(segmentDuration(segment), overlay.endOffsetSeconds)
            ),
            text: overlay.text,
            kind: overlay.type,
            position: overlay.position,
          },
        ];
      });

      const assContent = generateAss({
        cues: shiftedCues,
        overlays: overlayCues,
        appearance,
        width: outputWidth,
        height: outputHeight,
        format,
      });
      if (!includeCaptions || shiftedCues.length > 0 || overlayCues.length > 0) {
        subtitlePath = path.join(rendersDir, `clip-${clipId}${preview ? "-preview" : ""}.ass`);
        await fs.writeFile(subtitlePath, assContent, "utf8");
      }
    } else if (preview) {
      // Previews never fail on missing captions — render without them.
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

  if (sequenceSegments.length > 0) {
    const mediaOverlays = editorState.overlays.flatMap((overlay) => {
      if (
        (overlay.type !== "image" && overlay.type !== "broll") ||
        !overlay.assetPath
      ) {
        return [];
      }
      const segment = sequenceSegments.find((item) => item.id === overlay.segmentId);
      if (!segment) return [];
      return [
        {
          inputPath: resolveStoragePath(overlay.assetPath),
          type: overlay.type,
          startTimeSeconds: outputTimeForSegment(
            sequenceSegments,
            segment.id,
            overlay.startOffsetSeconds
          ),
          endTimeSeconds: outputTimeForSegment(
            sequenceSegments,
            segment.id,
            Math.min(segmentDuration(segment), overlay.endOffsetSeconds)
          ),
          position: overlay.position,
          scalePercent: overlay.scalePercent,
        },
      ];
    });

    await ffmpegRenderSequence({
      inputPath,
      outputPath,
      segments: sequenceSegments.map((segment) => ({
        startTimeSeconds:
          renderStart + (segment.sourceStart - effectiveStart),
        endTimeSeconds:
          renderStart + (segment.sourceEnd - effectiveStart),
        volume: segment.volume,
        muted: segment.muted,
        fadeInSeconds: segment.fadeInSeconds,
        fadeOutSeconds: segment.fadeOutSeconds,
      })),
      format,
      width: outputWidth,
      height: outputHeight,
      srtPath: subtitlePath,
      captionAppearance: appearance,
      normalizeAudio: editorState.settings.normalizeAudio,
      denoiseAudio: editorState.settings.denoiseAudio,
      verticalBackground: editorState.settings.verticalBackground,
      mediaOverlays,
    });
  } else {
    await ffmpegRender({
      inputPath,
      outputPath,
      startTimeSeconds: renderStart,
      endTimeSeconds: preview
        ? Math.min(renderEnd, renderStart + PREVIEW_MAX_SECONDS)
        : renderEnd,
      format,
      layout,
      width: format === "vertical" ? outputWidth : undefined,
      height: format === "vertical" ? outputHeight : undefined,
      srtPath: subtitlePath,
      subtitleFormat: format,
      outputHeight,
      captionAppearance: appearance,
      verticalLayout: resolvedVerticalLayout?.resolved,
      previewQuality: preview,
      facecamRegion: facecam
        ? {
            x: facecam.x,
            y: facecam.y,
            width: facecam.width,
            height: facecam.height,
          }
        : undefined,
    });
  }

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
      ...(resolvedVerticalLayout
        ? { layout: resolvedVerticalLayout.effectiveLayout }
        : {}),
      logs: logs as unknown as Prisma.InputJsonValue,
    },
  });

  if (clipSuggestionId && !preview) {
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
