import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/db";
import { probeMedia } from "@/lib/ffmpeg";
import { generateSrt } from "@/lib/time";
import {
  PLATFORM_KEYS,
  PLATFORM_PRESETS,
  platformSettings,
} from "@/lib/platforms/presets";
import type {
  CreatePlatformExportPackInput,
  PlatformCopy,
  PlatformExportSettings,
  PlatformKey,
} from "@/lib/platforms/types";
import {
  ensureDir,
  fileExists,
  getRendersDir,
  resolveStoragePath,
  toRelativeStoragePath,
} from "@/lib/storage";
import { toJsonValue } from "@/lib/utils";
import { generatePlatformCopy } from "@/services/platformCopyService";
import { renderPlatformVideo } from "@/services/platformRenderService";
import { validateCompletedPlatformExport } from "@/services/platformValidationService";
import { getTranscriptChunksForRange } from "@/services/transcriptService";

const PLATFORM_WORKER_ID = `platform-${process.pid}-${randomUUID().slice(0, 8)}`;
const STALE_EXPORT_MS = 15 * 60 * 1000;

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function parseSettings(value: unknown): PlatformExportSettings {
  if (!value || typeof value !== "object") {
    throw new Error("Platform export settings are missing");
  }
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.outputId !== "string" ||
    typeof raw.width !== "number" ||
    typeof raw.height !== "number" ||
    typeof raw.aspectRatio !== "string"
  ) {
    throw new Error("Platform export settings are invalid");
  }
  return {
    outputId: raw.outputId,
    width: raw.width,
    height: raw.height,
    aspectRatio: raw.aspectRatio,
    includeCaptions: Boolean(raw.includeCaptions),
    burnSubtitles: Boolean(raw.burnSubtitles),
    generateCopy: raw.generateCopy !== false,
    xQuoteCard: Boolean(raw.xQuoteCard),
    xQuoteLayout:
      raw.xQuoteLayout === "quote_bottom" || raw.xQuoteLayout === "overlay"
        ? raw.xQuoteLayout
        : "quote_top",
  };
}

function copyData(copy: PlatformCopy) {
  return {
    title: copy.title,
    caption: copy.caption,
    postText: copy.postText,
    description: copy.description,
    hashtags: toJsonValue(copy.hashtags),
    tags: toJsonValue(copy.tags),
    quoteText: copy.quoteText,
    thumbnailText: copy.thumbnailText,
    pinnedComment: copy.pinnedComment,
  };
}

async function buildCopyContext(platformExportId: string) {
  const platformExport = await prisma.platformExport.findUnique({
    where: { id: platformExportId },
    include: {
      clipSuggestion: true,
      streamSession: {
        select: { title: true, channelTitle: true },
      },
    },
  });
  if (!platformExport) throw new Error("Platform export not found");

  const clip = platformExport.clipSuggestion;
  const [transcriptChunks, chatWindows] = await Promise.all([
    getTranscriptChunksForRange(
      platformExport.streamSessionId,
      clip.startTimeSeconds,
      clip.endTimeSeconds
    ),
    prisma.eventWindow.findMany({
      where: {
        streamSessionId: platformExport.streamSessionId,
        type: "chat_window",
        startTimeSeconds: { lte: clip.endTimeSeconds },
        endTimeSeconds: { gte: clip.startTimeSeconds },
      },
      orderBy: { score: "desc" },
      take: 5,
      select: { summary: true },
    }),
  ]);

  const transcriptText = transcriptChunks
    .filter((chunk) => !/^\[(silence|processing error)\]$/i.test(chunk.text.trim()))
    .map((chunk) => chunk.text.trim())
    .filter(Boolean)
    .join(" ")
    .slice(0, 8000);

  return {
    platformExport,
    copyInput: {
      platform: platformExport.platform as PlatformKey,
      clipTitle: clip.title,
      clipReason: clip.reason,
      transcriptText,
      chatSignals: chatWindows.map((item) => item.summary).filter(Boolean).join(" | "),
      streamTitle: platformExport.streamSession.title,
      streamerName: platformExport.streamSession.channelTitle,
      durationSeconds: clip.endTimeSeconds - clip.startTimeSeconds,
    },
    transcriptChunks,
  };
}

export async function createPlatformExportPack(
  clipSuggestionId: string,
  input: CreatePlatformExportPackInput
) {
  const clip = await prisma.clipSuggestion.findUnique({
    where: { id: clipSuggestionId },
    include: {
      renderJobs: {
        where: { status: "completed", outputPath: { not: null } },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });
  if (!clip) throw new Error("Clip not found");
  const renderJob = clip.renderJobs[0];
  if (!renderJob?.outputPath || !fileExists(renderJob.outputPath)) {
    throw new Error("Render the clip before creating platform exports");
  }

  const platforms = [...new Set(input.platforms)].filter(
    (platform): platform is PlatformKey => PLATFORM_KEYS.includes(platform)
  );
  if (platforms.length === 0) throw new Error("Choose at least one platform");

  return prisma.platformExportPack.create({
    data: {
      clipSuggestionId: clip.id,
      streamSessionId: clip.streamSessionId,
      name: `${clip.title} - Platform Export Pack`,
      exports: {
        create: platforms.map((platform) => ({
          clipSuggestionId: clip.id,
          streamSessionId: clip.streamSessionId,
          renderJobId: renderJob.id,
          platform,
          presetName: PLATFORM_PRESETS[platform].name,
          exportSettings: toJsonValue(
            platformSettings(platform, {
              outputId: input.outputOptions?.[platform],
              includeCaptions: input.includeCaptions,
              burnSubtitles: input.burnSubtitles,
              generateCopy: input.generateCopy,
              xQuoteCard: input.xQuoteCard,
              xQuoteLayout: input.xQuoteLayout,
            })
          ),
        })),
      },
    },
    include: {
      clipSuggestion: {
        select: {
          id: true,
          title: true,
          reason: true,
          startTimeSeconds: true,
          endTimeSeconds: true,
        },
      },
      exports: true,
    },
  });
}

export async function getPlatformExportPack(packId: string) {
  return prisma.platformExportPack.findUnique({
    where: { id: packId },
    include: {
      clipSuggestion: {
        select: {
          id: true,
          title: true,
          reason: true,
          startTimeSeconds: true,
          endTimeSeconds: true,
        },
      },
      exports: true,
    },
  });
}

export function serializePlatformExportPack(
  pack: NonNullable<Awaited<ReturnType<typeof getPlatformExportPack>>>
) {
  const order = new Map(PLATFORM_KEYS.map((key, index) => [key, index]));
  return {
    id: pack.id,
    name: pack.name,
    status: pack.status,
    errorMessage: pack.errorMessage,
    clip: {
      ...pack.clipSuggestion,
      durationSeconds:
        pack.clipSuggestion.endTimeSeconds - pack.clipSuggestion.startTimeSeconds,
      previewUrl: `/api/clips/${pack.clipSuggestion.id}/stream`,
    },
    createdAt: pack.createdAt.toISOString(),
    updatedAt: pack.updatedAt.toISOString(),
    downloadZipUrl: `/api/platform-export-packs/${pack.id}/download`,
    exports: [...pack.exports]
      .sort(
        (a, b) =>
          (order.get(a.platform as PlatformKey) ?? 99) -
          (order.get(b.platform as PlatformKey) ?? 99)
      )
      .map((item) => ({
        id: item.id,
        platform: item.platform,
        presetName: item.presetName,
        status: item.status,
        progress: item.progress,
        title: item.title,
        caption: item.caption,
        postText: item.postText,
        description: item.description,
        hashtags: stringArray(item.hashtags),
        tags: stringArray(item.tags),
        quoteText: item.quoteText,
        thumbnailText: item.thumbnailText,
        pinnedComment: item.pinnedComment,
        warnings: stringArray(item.validationWarnings),
        settings: parseSettings(item.exportSettings),
        width: item.width,
        height: item.height,
        durationSeconds: item.durationSeconds,
        fileSizeBytes: item.fileSizeBytes?.toString() ?? null,
        errorMessage: item.errorMessage,
        videoUrl:
          item.status === "completed"
            ? `/api/platform-exports/${item.id}/stream`
            : null,
        downloadUrl:
          item.status === "completed"
            ? `/api/platform-exports/${item.id}/download`
            : null,
        thumbnailUrl: item.thumbnailPath
          ? `/api/platform-exports/${item.id}/thumbnail`
          : null,
      })),
  };
}

async function updatePackStatus(exportPackId: string) {
  const exports = await prisma.platformExport.findMany({
    where: { exportPackId },
    select: { status: true, errorMessage: true },
  });
  const active = exports.some((item) => item.status === "queued" || item.status === "processing");
  const completed = exports.filter((item) => item.status === "completed").length;
  const failed = exports.filter((item) => item.status === "failed");
  const status = active ? "processing" : completed > 0 ? "completed" : "failed";
  await prisma.platformExportPack.update({
    where: { id: exportPackId },
    data: {
      status,
      errorMessage:
        !active && failed.length > 0
          ? `${failed.length} export${failed.length === 1 ? "" : "s"} failed`
          : null,
    },
  });
}

export async function reclaimStalePlatformExports(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_EXPORT_MS);
  const result = await prisma.platformExport.updateMany({
    where: { status: "processing", lockedAt: { lt: cutoff } },
    data: {
      status: "queued",
      progress: 0,
      lockedAt: null,
      lockedBy: null,
      errorMessage: "Requeued after worker restart",
    },
  });
  return result.count;
}

export async function claimNextPlatformExport(): Promise<string | null> {
  const candidates = await prisma.platformExport.findMany({
    where: { status: "queued" },
    orderBy: { createdAt: "asc" },
    take: 8,
    select: { id: true, exportPackId: true },
  });
  for (const candidate of candidates) {
    const claimed = await prisma.platformExport.updateMany({
      where: { id: candidate.id, status: "queued" },
      data: {
        status: "processing",
        progress: 5,
        startedAt: new Date(),
        lockedAt: new Date(),
        lockedBy: PLATFORM_WORKER_ID,
        errorMessage: null,
      },
    });
    if (claimed.count === 1) {
      await prisma.platformExportPack.update({
        where: { id: candidate.exportPackId },
        data: { status: "processing" },
      });
      return candidate.id;
    }
  }
  return null;
}

async function subtitleFileForExport(
  platformExportId: string,
  outputDir: string,
  clipStart: number,
  clipEnd: number,
  chunks: Array<{ startTimeSeconds: number; endTimeSeconds: number; text: string }>
): Promise<string | null> {
  const entries = chunks
    .filter((chunk) => chunk.endTimeSeconds > clipStart && chunk.startTimeSeconds < clipEnd)
    .filter((chunk) => !/^\[(silence|processing error)\]$/i.test(chunk.text.trim()))
    .map((chunk) => ({
      startTimeSeconds: Math.max(0, chunk.startTimeSeconds - clipStart),
      endTimeSeconds: Math.min(clipEnd - clipStart, chunk.endTimeSeconds - clipStart),
      text: chunk.text.trim(),
    }))
    .filter((entry) => entry.text && entry.endTimeSeconds > entry.startTimeSeconds);
  if (entries.length === 0) return null;
  const subtitlePath = path.join(outputDir, `${platformExportId}.srt`);
  await fs.writeFile(subtitlePath, generateSrt(entries), "utf8");
  return subtitlePath;
}

export async function executePlatformExport(platformExportId: string) {
  const context = await buildCopyContext(platformExportId);
  const { platformExport, copyInput, transcriptChunks } = context;
  const settings = parseSettings(platformExport.exportSettings);
  const platform = platformExport.platform as PlatformKey;
  const copy = settings.generateCopy
    ? await generatePlatformCopy(copyInput)
    : {
        title: null,
        caption: null,
        postText: null,
        description: null,
        hashtags: [],
        tags: [],
        quoteText: copyInput.transcriptText.slice(0, 120) || copyInput.clipReason.slice(0, 120),
        thumbnailText: null,
        pinnedComment: null,
      };

  await prisma.platformExport.update({
    where: { id: platformExportId },
    data: { ...copyData(copy), progress: 25, lockedAt: new Date() },
  });

  const renderJob = platformExport.renderJobId
    ? await prisma.renderJob.findUnique({ where: { id: platformExport.renderJobId } })
    : null;
  if (!renderJob?.outputPath || !fileExists(renderJob.outputPath)) {
    throw new Error("The rendered clip file is no longer available");
  }

  const outputDir = path.join(
    getRendersDir(platformExport.streamSessionId),
    "platform-packs",
    platformExport.exportPackId
  );
  await ensureDir(outputDir);
  const outputPath = path.join(outputDir, `${platform}.mp4`);
  const thumbnailPath = path.join(outputDir, `${platform}-cover.jpg`);
  const clip = platformExport.clipSuggestion;
  const subtitlePath = settings.includeCaptions || settings.burnSubtitles
    ? await subtitleFileForExport(
        platformExportId,
        outputDir,
        clip.startTimeSeconds,
        clip.endTimeSeconds,
        transcriptChunks
      )
    : null;

  await prisma.platformExport.update({
    where: { id: platformExportId },
    data: { progress: 40, lockedAt: new Date() },
  });

  const renderResult = await renderPlatformVideo({
    platform,
    inputPath: resolveStoragePath(renderJob.outputPath),
    outputPath,
    thumbnailPath,
    settings,
    subtitlePath: settings.burnSubtitles ? subtitlePath : null,
    quoteText: copy.quoteText,
  });

  const [probe, stat] = await Promise.all([probeMedia(outputPath), fs.stat(outputPath)]);
  const validationWarnings = [
    ...renderResult.warnings,
    ...validateCompletedPlatformExport({
      platform,
      width: probe.width,
      height: probe.height,
      durationSeconds: probe.durationSeconds,
      fileSizeBytes: stat.size,
      format: path.extname(outputPath).slice(1),
      videoCodec: probe.videoCodec,
      audioCodec: probe.audioCodec,
      copy,
    }),
  ];

  await prisma.platformExport.update({
    where: { id: platformExportId },
    data: {
      status: "completed",
      progress: 100,
      outputPath: toRelativeStoragePath(outputPath),
      thumbnailPath: existsSync(thumbnailPath)
        ? toRelativeStoragePath(thumbnailPath)
        : null,
      width: probe.width || settings.width,
      height: probe.height || settings.height,
      durationSeconds: probe.durationSeconds || copyInput.durationSeconds,
      fileSizeBytes: BigInt(stat.size),
      validationWarnings: toJsonValue(validationWarnings),
      errorMessage: null,
      lockedAt: null,
      lockedBy: null,
      completedAt: new Date(),
    },
  });
  await updatePackStatus(platformExport.exportPackId);
}

export async function failPlatformExport(
  platformExportId: string,
  error: unknown
) {
  const message = error instanceof Error ? error.message : String(error);
  const platformExport = await prisma.platformExport.update({
    where: { id: platformExportId },
    data: {
      status: "failed",
      errorMessage: message.slice(0, 4000),
      lockedAt: null,
      lockedBy: null,
    },
  });
  await updatePackStatus(platformExport.exportPackId);
}

export async function regeneratePlatformExportCopy(platformExportId: string) {
  const { platformExport, copyInput } = await buildCopyContext(platformExportId);
  const copy = await generatePlatformCopy(copyInput);
  const settings = parseSettings(platformExport.exportSettings);
  const warnings = validateCompletedPlatformExport({
    platform: platformExport.platform as PlatformKey,
    width: platformExport.width ?? settings.width,
    height: platformExport.height ?? settings.height,
    durationSeconds: platformExport.durationSeconds ?? copyInput.durationSeconds,
    fileSizeBytes: Number(platformExport.fileSizeBytes ?? 0),
    format: "mp4",
    videoCodec: "h264",
    audioCodec: "aac",
    copy,
  });
  return prisma.platformExport.update({
    where: { id: platformExportId },
    data: {
      ...copyData(copy),
      validationWarnings: toJsonValue(warnings),
    },
  });
}

export async function getPlatformExportFile(exportId: string) {
  return prisma.platformExport.findUnique({
    where: { id: exportId },
    select: {
      id: true,
      streamSessionId: true,
      platform: true,
      presetName: true,
      status: true,
      outputPath: true,
      thumbnailPath: true,
    },
  });
}

export function subtitlePathForExportOutput(
  outputPath: string,
  platformExportId: string
): string {
  return path.join(path.dirname(outputPath), `${platformExportId}.srt`);
}
