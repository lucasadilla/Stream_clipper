import path from "path";
import fs from "fs/promises";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getPostHogClient } from "@/lib/posthog-server";
import {
  renderShort as ffmpegRender,
  renderSequence as ffmpegRenderSequence,
  isFfmpegAvailable,
  formatFfmpegProcessError,
  probeMedia,
} from "@/lib/ffmpeg";
import { formatCaptionTextForBurn } from "@/lib/captionStyles";
import { generateAss } from "@/lib/captionAss";
import {
  buildCaptionTrack,
  type CaptionCue,
} from "@/lib/captionTrack";
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
import { parsePlatformRenderTarget, platformRenderDimensions, type PlatformRenderTarget } from "@/lib/platforms/renderTarget";
import { PLATFORM_SAFE_ZONES } from "@/lib/platforms/safeZones";
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
import { rangeCoversWholeSource } from "@/lib/renderRange";
import { reviewRenderedOutput } from "@/services/postRenderCriticService";
import type { PostRenderQualityReview } from "@/lib/postRenderCritic";
import { directCaptionTrack } from "@/lib/captionDirector";
import { getCachedCaptionDirectionForClip } from "@/services/captionDirectorService";
import { assertDeliverableVideo } from "@/services/deliverableVideoService";
import { renderSpecHash, storedRenderSpecHash } from "@/lib/renderSpec";
import { ensureSpeakerContext } from "@/services/speakerContextService";

const PREVIEW_MAX_SECONDS = 5;
const PREVIEW_HEIGHT = 640;

function evenDimension(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}

function nativeOutputDimensions(source: {
  width: number;
  height: number;
} | null): { width: number; height: number } {
  if (!source || source.width <= 0 || source.height <= 0) {
    return { width: 1920, height: 1080 };
  }

  const configuredMaxHeight = Number.parseInt(
    process.env.RENDER_NATIVE_MAX_HEIGHT?.trim() ?? "",
    10
  );
  const configuredMaxWidth = Number.parseInt(
    process.env.RENDER_NATIVE_MAX_WIDTH?.trim() ?? "",
    10
  );
  const maxHeight =
    Number.isFinite(configuredMaxHeight) && configuredMaxHeight >= 720
      ? configuredMaxHeight
      : 2160;
  const maxWidth =
    Number.isFinite(configuredMaxWidth) && configuredMaxWidth >= 1280
      ? configuredMaxWidth
      : 3840;
  const scale = Math.min(
    1,
    maxWidth / source.width,
    maxHeight / source.height
  );

  return {
    width: evenDimension(source.width * scale),
    height: evenDimension(source.height * scale),
  };
}

export interface RenderShortParams {
  platformTarget?: PlatformRenderTarget;
  streamSessionId: string;
  sourceMediaId?: string;
  clipSuggestionId?: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  format?: RenderFormat;
  layout?: "center_crop" | "facecam_overlay" | "facecam_top_gameplay_bottom" | "gameplay_full";
  includeCaptions?: boolean;
  captionAppearance?: CaptionAppearance;
  captionCues?: CaptionCue[];
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
    platformTarget: parsePlatformRenderTarget(raw.platformTarget),
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
    includeCaptions: raw.includeCaptions !== false,
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

type BurnCaptionCue = CaptionCue;

export function mergeRenderCaptionCoverage(
  generatedCues: CaptionCue[],
  clientCues: CaptionCue[]
): CaptionCue[] {
  const clientById = new Map(clientCues.map((cue) => [cue.id, cue]));
  const matchedClientIds = new Set<string>();
  const merged = generatedCues.map((generated) => {
    let client = clientById.get(generated.id);
    if (!client) {
      client = clientCues.find((candidate) => {
        if (matchedClientIds.has(candidate.id)) return false;
        const overlap = Math.max(
          0,
          Math.min(generated.endTimeSeconds, candidate.endTimeSeconds) -
            Math.max(generated.startTimeSeconds, candidate.startTimeSeconds)
        );
        const shortest = Math.max(
          0.05,
          Math.min(
            generated.endTimeSeconds - generated.startTimeSeconds,
            candidate.endTimeSeconds - candidate.startTimeSeconds
          )
        );
        return overlap / shortest >= 0.75;
      });
    }
    if (!client) return generated;
    matchedClientIds.add(client.id);
    // Prefer client text/trim edits, but keep authoritative STT word timings
    // whenever the browser cue omitted them — dropping words forces estimated
    // karaoke that drifts from the audio on export.
    return {
      ...generated,
      ...client,
      words:
        client.words && client.words.length > 0 ? client.words : generated.words,
    };
  });

  for (const client of clientCues) {
    if (!matchedClientIds.has(client.id)) {
      merged.push(client);
    }
  }
  return merged.sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);
}

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
      const wordEntries = cue.words
        ?.map((word, sourceIndex) => ({ word, sourceIndex }))
        .filter(({ word }) => word.end > overlapStart && word.start < overlapEnd);
      const words = wordEntries
        ?.map(({ word }) => ({
          ...word,
          start: outputOffset + Math.max(0, word.start - segment.sourceStart),
          end:
            outputOffset +
            Math.min(segmentDuration(segment), word.end - segment.sourceStart),
          word: word.word,
        }))
        .filter((word) => word.end > word.start && word.word.trim().length > 0);
      const remappedEmphasis = wordEntries
        ?.flatMap(({ sourceIndex }, outputIndex) =>
          cue.direction?.emphasisWordIndexes.includes(sourceIndex)
            ? [outputIndex]
            : []
        );
      mapped.push({
        ...cue,
        id: `${cue.id}-segment-${segment.id}`,
        startTimeSeconds:
          outputOffset + Math.max(0, overlapStart - segment.sourceStart),
        endTimeSeconds:
          outputOffset + Math.min(segmentDuration(segment), overlapEnd - segment.sourceStart),
        text: formatCaptionTextForBurn(cue.text, format),
        ...(words?.length ? { words } : {}),
        ...(cue.direction
          ? {
              direction: {
                ...cue.direction,
                emphasisWordIndexes: remappedEmphasis ?? [],
              },
            }
          : {}),
      });
    }
    outputOffset += segmentDuration(segment);
  }
  return mapped;
}

async function updateJobProgress(
  jobId: string,
  progress: number,
  step?: string,
  options: { log?: boolean } = {}
) {
  const updated = await prisma.renderJob.updateMany({
    where: { id: jobId, status: "processing" },
    data: {
      progress: Math.min(100, Math.max(0, Math.round(progress))),
      // Progress writes double as a lease heartbeat. A healthy long render can
      // no longer be reclaimed while FFmpeg is still producing frames.
      lockedAt: new Date(),
    },
  });
  if (updated.count > 0 && step && options.log !== false) {
    await appendRenderJobLog(jobId, step, `Progress ${Math.round(progress)}%`);
  }
}

function createEncodingProgressReporter(jobId: string) {
  let lastJobProgress = 54;
  let lastUpdateAt = 0;
  let queue = Promise.resolve();

  return {
    report(progress: number) {
      const next = 55 + Math.floor(Math.min(1, Math.max(0, progress)) * 34);
      const now = Date.now();
      if (next <= lastJobProgress && now - lastUpdateAt < 5_000) return;
      if (next > lastJobProgress && next - lastJobProgress < 1 && now - lastUpdateAt < 1_500) {
        return;
      }
      lastJobProgress = Math.max(lastJobProgress, next);
      lastUpdateAt = now;
      const queuedProgress = lastJobProgress;
      queue = queue.then(() =>
        updateJobProgress(jobId, queuedProgress, "encoding", { log: false })
      );
    },
    async flush() {
      await queue;
    },
  };
}

async function completeRenderJob(input: {
  jobId: string;
  params: RenderShortParams;
  outputPath: string;
  relativeOutput: string;
  completionMessage: string;
  resolvedLayout?: string;
  sourceDimensions?: { width: number; height: number };
  expectedOutput?: {
    width: number;
    height: number;
    durationSeconds: number;
    audio: boolean;
  };
}): Promise<void> {
  const outputStat = await fs.stat(input.outputPath).catch(() => null);
  if (!outputStat || outputStat.size < 1024) {
    throw new Error(
      "Render finished but the output file is missing or empty. Try rendering again."
    );
  }

  // A non-empty path is not enough: truncated MP4s and files without a
  // decodable video stream must never be marked completed or offered to users.
  await assertDeliverableVideo(input.outputPath);
  const outputProbe = await probeMedia(input.outputPath);
  if (input.expectedOutput) {
    const expected = input.expectedOutput;
    if (outputProbe.width !== expected.width || outputProbe.height !== expected.height) {
      throw new Error(
        `Render produced ${outputProbe.width}x${outputProbe.height}; expected ${expected.width}x${expected.height}.`
      );
    }
    const durationTolerance = Math.max(1, expected.durationSeconds * 0.05);
    if (
      Math.abs(outputProbe.durationSeconds - expected.durationSeconds) >
      durationTolerance
    ) {
      throw new Error(
        `Render duration was ${outputProbe.durationSeconds.toFixed(2)}s; expected ${expected.durationSeconds.toFixed(2)}s.`
      );
    }
    if (expected.audio && !outputProbe.audioCodec) {
      throw new Error("Render finished without the source audio track.");
    }
    await appendRenderJobLog(
      input.jobId,
      "output_validated",
      `${outputProbe.width}x${outputProbe.height}, ${outputProbe.durationSeconds.toFixed(2)}s, ${outputProbe.videoCodec}/${outputProbe.audioCodec ?? "no audio"}`
    );
  }

  let qualityReview: PostRenderQualityReview | null = null;
  if (!input.params.preview) {
    await updateJobProgress(input.jobId, 94, "quality_check");
    try {
      qualityReview = await reviewRenderedOutput({
        outputPath: input.outputPath,
        params: input.params,
        sourceDimensions: input.sourceDimensions,
      });
      await appendRenderJobLog(
        input.jobId,
        "quality_check",
        `${qualityReview.reviewer === "ai_visual" ? "AI visual" : "Technical"} review: ${qualityReview.verdict} (${qualityReview.score}/100)`,
        qualityReview.verdict === "pass" ? "info" : "warn"
      );
    } catch (error) {
      await appendRenderJobLog(
        input.jobId,
        "quality_check",
        `Quality review skipped: ${error instanceof Error ? error.message : String(error)}`,
        "warn"
      );
    }
  }

  const existing = await prisma.renderJob.findUnique({
    where: { id: input.jobId },
    select: { logs: true },
  });
  const logs = [
    ...parseRenderJobLogs(existing?.logs),
    makeRenderJobLogEntry("completed", input.completionMessage),
  ];

  await prisma.renderJob.update({
    where: { id: input.jobId },
    data: {
      status: "completed",
      progress: 100,
      outputPath: input.relativeOutput,
      completedAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      errorMessage: null,
      ...(input.resolvedLayout ? { layout: input.resolvedLayout } : {}),
      ...(qualityReview
        ? { qualityReview: qualityReview as unknown as Prisma.InputJsonValue }
        : {}),
      logs: logs as unknown as Prisma.InputJsonValue,
    },
  });

  if (input.params.clipSuggestionId && !input.params.preview) {
    await prisma.clipSuggestion.update({
      where: { id: input.params.clipSuggestionId },
      data: { status: "rendered" },
    });

    const completed = await prisma.renderJob.findUnique({
      where: { id: input.jobId },
      select: {
        streamSession: { select: { billingAccountId: true, mode: true } },
        clipSuggestionId: true,
      },
    });
    const billingAccountId = completed?.streamSession.billingAccountId;
    if (billingAccountId) {
      const properties = {
        clip_id: completed.clipSuggestionId,
        workflow: completed.streamSession.mode,
        $insert_id: `${input.jobId}:completed`,
      };
      getPostHogClient().capture({
        distinctId: billingAccountId,
        event: "clip_rendered",
        properties,
      });
      getPostHogClient().capture({
        distinctId: billingAccountId,
        event: "first_clip_rendered",
        properties: {
          ...properties,
          $insert_id: `${billingAccountId}:first_clip_rendered`,
        },
      });
    }
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
      sourceMediaId,
      {
        purpose: preview ? "preview" : "final",
        onStage: (progress, step) => updateJobProgress(jobId, progress, step),
        onWarning: (step, message) =>
          appendRenderJobLog(jobId, step, message, "warn"),
      }
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
  await prisma.renderJob.update({
    where: { id: jobId },
    data: { sourceMediaId: renderSource.id },
  });

  const renderStart = clipSource.renderStart;
  const renderEnd = clipSource.renderEnd;

  const clipId = clipSuggestionId ?? `custom-${Date.now()}`;
  const rendersDir = getRendersDir(streamSessionId);
  await ensureDir(rendersDir);

  const outputFilename = preview
    ? `clip-${clipId}-preview-${jobId.slice(-8)}.mp4`
    : `clip-${clipId}-${format}-${jobId}.mp4`;
  const outputPath = path.join(rendersDir, outputFilename);
  const relativeOutput = toRelativeStoragePath(outputPath);

  const inputPath = resolveStoragePath(renderSource.filePath);
  const inputProbe = await probeMedia(inputPath).catch(() => null);
  if (
    !inputProbe?.videoCodec ||
    inputProbe.width < 2 ||
    inputProbe.height < 2 ||
    (!preview && inputProbe.durationSeconds <= 0)
  ) {
    throw new Error(
      "The selected source video is incomplete or unreadable. Clipper stopped before encoding; retry after the source finishes processing or upload the original file."
    );
  }
  if (
    renderStart < 0 ||
    renderEnd <= renderStart ||
    (inputProbe.durationSeconds > 0 &&
      renderStart >= inputProbe.durationSeconds - 0.05)
  ) {
    throw new Error(
      "The selected clip range falls outside the available source video. Reopen the clip and choose a valid range."
    );
  }
  const nativeDimensions = nativeOutputDimensions(inputProbe);
  let subtitlePath: string | undefined;
  let burnedCaptionCueCount = 0;
  const platformOutput = params.platformTarget ? platformRenderDimensions(params.platformTarget) : undefined;
  const outputHeight = preview
    ? PREVIEW_HEIGHT
    : platformOutput?.height ?? (format === "vertical"
      ? Math.max(720, Number.parseInt(process.env.RENDER_VERTICAL_HEIGHT || "1920", 10) || 1920)
      : nativeDimensions.height);
  const outputWidth =
    !preview && platformOutput ? platformOutput.width : format === "vertical"
      ? Math.round((outputHeight * 9) / 16)
      : preview
        ? Math.round((outputHeight * 16) / 9)
        : nativeDimensions.width;

  await appendRenderJobLog(
    jobId,
    "source_quality",
    `Source ${inputProbe.width}x${inputProbe.height} at ${inputProbe.fps.toFixed(2)} fps; export ${outputWidth}x${outputHeight}`,
    !preview && inputProbe.height < 720 ? "warn" : "info"
  );

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

  if (params.platformTarget && appearance.vertical === "bottom") {
    appearance = {
      ...appearance,
      verticalOffsetPercent: Math.max(appearance.verticalOffsetPercent,
        PLATFORM_SAFE_ZONES[params.platformTarget.platform].subtitleBottomPercent),
    };
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
    !platformOutput &&
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

    // Some muxed segment-* files already equal the requested range. Only skip
    // ffmpeg when both in and out points cover the whole cached file.
    const alreadyCut =
      /^(?:segment|render-source)-/i.test(path.basename(inputPath)) &&
      rangeCoversWholeSource(
        cutStart,
        cutEnd,
        renderSource.durationSeconds
      );
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
    await completeRenderJob({
      jobId,
      params,
      outputPath,
      relativeOutput,
      completionMessage: "Stream copy finished",
      sourceDimensions: inputProbe
        ? { width: inputProbe.width, height: inputProbe.height }
        : undefined,
      expectedOutput: {
        width: outputWidth,
        height: outputHeight,
        durationSeconds: cutEnd - cutStart,
        audio: Boolean(inputProbe?.audioCodec),
      },
    });

    return { outputPath: relativeOutput };
  }

  if (includeCaptions || textOverlays.length > 0) {
    await updateJobProgress(jobId, 35, "captions");
    let authoritativeRefinement = false;
    if (includeCaptions && !preview && clipSuggestionId) {
      const { refineClipTranscript } = await import("@/services/clipTranscriptRefinementService");
      const refinement = await refineClipTranscript(clipSuggestionId, {
        inputPath, timelineOffsetSeconds: effectiveStart - renderStart,
        startTimeSeconds: effectiveStart, endTimeSeconds: effectiveEnd,
      });
      authoritativeRefinement = refinement.status === "refined" || refinement.status === "cached";
      await appendRenderJobLog(jobId, "caption_refinement",
        authoritativeRefinement ? "Verified captions against the source audio" :
          `Using the available transcript: ${refinement.reason ?? refinement.status}`);
    }
    const speakerContext = includeCaptions
      ? await ensureSpeakerContext(streamSessionId).catch((error) => {
          console.warn("[render] speaker context unavailable:", error);
          return null;
        })
      : null;
    // Persisted manual edits are applied below. A stale browser copy must not
    // overwrite words recovered by the final audio verification pass.
    const clientCues = (authoritativeRefinement ? [] : clientCaptionCues ?? []).filter(
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
    // Always load the authoritative transcript for the full final range. The
    // browser may have queued a render while a newly extended caption window
    // was still loading; client cues should override edits, not define coverage.
    const chunks = !includeCaptions
      ? []
      : await getTranscriptChunksForRange(
          streamSessionId,
          effectiveStart,
          effectiveEnd
        );
    if (!includeCaptions || clientCues.length > 0 || chunks.length > 0) {
      const captionEdits = await readCaptionEdits(streamSessionId);
      const generatedCaptionLines: BurnCaptionCue[] = !includeCaptions
        ? []
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
              format,
              { speakerContext: speakerContext ?? undefined }
            ),
            captionEdits
          );
      const baseCaptionLines: BurnCaptionCue[] = mergeRenderCaptionCoverage(
        generatedCaptionLines,
        clientCues
      );
      const cachedDirection =
        clipSuggestionId && baseCaptionLines.length > 0
          ? await getCachedCaptionDirectionForClip(
              clipSuggestionId,
              baseCaptionLines
            )
          : null;
      const captionLines = directCaptionTrack(
        baseCaptionLines,
        cachedDirection
      );

      const shiftedCues = sequenceSegments.length
        ? mapCaptionsToSequence(captionLines, sequenceSegments, format)
        : captionLines
            .map((cue) => {
              const wordEntries = cue.words
                ?.map((word, sourceIndex) => ({ word, sourceIndex }))
                .filter(
                  ({ word }) =>
                    word.end > effectiveStart && word.start < effectiveEnd
                );
              const words = wordEntries
                ?.map(({ word }) => ({
                  ...word,
                  start: Math.max(0, word.start - effectiveStart),
                  end: Math.min(
                    effectiveEnd - effectiveStart,
                    word.end - effectiveStart
                  ),
                  word: word.word,
                }))
                .filter(
                  (word) => word.end > word.start && word.word.trim().length > 0
                );
              const emphasisWordIndexes = wordEntries
                ?.flatMap(({ sourceIndex }, outputIndex) =>
                  cue.direction?.emphasisWordIndexes.includes(sourceIndex)
                    ? [outputIndex]
                    : []
                );
              return {
                ...cue,
                id: cue.id,
                startTimeSeconds: Math.max(
                  0,
                  cue.startTimeSeconds - effectiveStart
                ),
                endTimeSeconds: Math.min(
                  effectiveEnd - effectiveStart,
                  cue.endTimeSeconds - effectiveStart
                ),
                text: formatCaptionTextForBurn(cue.text, format),
                ...(words?.length ? { words } : {}),
                ...(cue.direction
                  ? {
                      direction: {
                        ...cue.direction,
                        emphasisWordIndexes: emphasisWordIndexes ?? [],
                      },
                    }
                  : {}),
              };
            })
            .filter((cue) => cue.endTimeSeconds > cue.startTimeSeconds);

      if (includeCaptions && shiftedCues.length === 0 && !preview) {
        throw new Error("Captions are enabled, but no caption cues overlap this clip.");
      }
      burnedCaptionCueCount = includeCaptions ? shiftedCues.length : 0;

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
        // Final downloads must lock to transcript timestamps; keep stylized
        // motion only for quick studio previews.
        syncMode: preview ? "stylized" : "precise",
      });
      if (
        (includeCaptions && shiftedCues.length > 0) ||
        overlayCues.length > 0
      ) {
        subtitlePath = path.join(rendersDir, `clip-${clipId}-${jobId}.ass`);
        await fs.writeFile(subtitlePath, assContent, "utf8");
        await appendRenderJobLog(
          jobId,
          "captions_ready",
          `Prepared ${shiftedCues.length} timed caption cue${
            shiftedCues.length === 1 ? "" : "s"
          } for burn-in`
        );
      }
    } else if (preview || !includeCaptions) {
      // Previews never fail on missing captions.
    } else {
      throw new Error(
        "Captions are enabled, but transcription has not reached this clip yet. " +
          "Wait until captions appear in the selected timeline range, then render again."
      );
    }
  }

  if (includeCaptions && !preview && (!subtitlePath || burnedCaptionCueCount === 0)) {
    throw new Error(
      "Captions are enabled, but the final burn-in track could not be prepared."
    );
  }

  const facecam =
    layout !== "center_crop"
      ? await prisma.facecamRegion.findFirst({
          where: { streamSessionId },
          orderBy: { confidence: "desc" },
        })
      : null;

  await appendRenderJobLog(jobId, "encoding", "Encoding clip");
  await updateJobProgress(jobId, 55, undefined, { log: false });
  const encodingProgress = createEncodingProgressReporter(jobId);

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
      onProgress: encodingProgress.report,
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
      onProgress: encodingProgress.report,
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
  await encodingProgress.flush();

  if (subtitlePath) {
    await appendRenderJobLog(
      jobId,
      "captions_burned",
      `Burned ${burnedCaptionCueCount} timed caption cue${
        burnedCaptionCueCount === 1 ? "" : "s"
      } into the video`
    );
  }

  await completeRenderJob({
    jobId,
    params,
    outputPath,
    relativeOutput,
    completionMessage: "Render finished",
    sourceDimensions: inputProbe ? { width: inputProbe.width, height: inputProbe.height } : undefined,
    resolvedLayout: resolvedVerticalLayout?.effectiveLayout,
    expectedOutput: {
      width: outputWidth,
      height: outputHeight,
      durationSeconds:
        sequenceSegments.length > 0
          ? sequenceSegments.reduce(
              (total, segment) => total + segmentDuration(segment),
              0
            )
          : (preview
              ? Math.min(renderEnd, renderStart + PREVIEW_MAX_SECONDS)
              : renderEnd) - renderStart,
      audio: Boolean(inputProbe.audioCodec),
    },
  });

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
  const specHash = renderSpecHash(params.renderParams);
  const activeJobs = await prisma.renderJob.findMany({
    where: {
      streamSessionId: params.streamSessionId,
      clipSuggestionId: params.clipSuggestionId ?? null,
      OR: [
        {
          status: "queued",
          updatedAt: { gte: new Date(Date.now() - 10 * 60_000) },
        },
        {
          status: "processing",
          // Do not attach a new request to an abandoned process. Healthy jobs
          // refresh this timestamp through progress and worker heartbeats.
          updatedAt: { gte: new Date(Date.now() - 2 * 60_000) },
        },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 8,
    select: { id: true, params: true },
  });
  const duplicate = activeJobs.find(
    (candidate) => storedRenderSpecHash(candidate.params) === specHash
  );
  if (duplicate) return duplicate.id;

  const storedParams = {
    ...params.renderParams,
    renderSpecHash: specHash,
  };
  const job = await prisma.renderJob.create({
    data: {
      streamSessionId: params.streamSessionId,
      clipSuggestionId: params.clipSuggestionId,
      sourceMediaId: params.sourceMediaId,
      status: "queued",
      progress: 0,
      layout: params.layout ?? "center_crop",
      includeCaptions: params.includeCaptions ?? true,
      params: storedParams as unknown as Prisma.InputJsonValue,
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
  const timeoutMs = options.timeoutMs ?? 30 * 60 * 1000;
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
  return prisma.renderJob.findUnique({
    where: { id: renderJobId },
    include: {
      clipSuggestion: { select: { title: true } },
      streamSession: { select: { title: true } },
    },
  });
}
