import path from "path";
import fs from "fs/promises";
import {
  getFfmpegPath,
  getFfmpegThreadCount,
  isFfmpegLowMemoryMode,
  runCommand,
} from "@/lib/ffmpeg";
import { PLATFORM_SAFE_ZONES } from "@/lib/platforms/safeZones";
import type {
  PlatformExportSettings,
  PlatformKey,
  XQuoteLayout,
} from "@/lib/platforms/types";

export interface RenderPlatformVideoInput {
  platform: PlatformKey;
  inputPath: string;
  outputPath: string;
  thumbnailPath: string;
  settings: PlatformExportSettings;
  subtitlePath?: string | null;
  quoteText?: string | null;
}

function escapeSubtitlePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

function escapeDrawtext(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:")
    .replace(/%/g, "\\%")
    .replace(/\r?\n/g, " ");
}

function wrapQuote(value: string, lineLength = 34): string {
  const words = value.trim().split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line && `${line} ${word}`.length > lineLength) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 3).join("\\n");
}

function standardVideoFilter(settings: PlatformExportSettings): string {
  const { width, height } = settings;
  if (settings.aspectRatio === "4:5" || settings.aspectRatio === "1:1") {
    return `scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=fast_bilinear,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=#050805`;
  }
  return `scale=${width}:${height}:force_original_aspect_ratio=increase:flags=fast_bilinear,crop=${width}:${height}`;
}

function quoteCardFilter(
  settings: PlatformExportSettings,
  quoteText: string,
  layout: XQuoteLayout
): string {
  const quote = escapeDrawtext(wrapQuote(quoteText));
  const fontSize = 52;
  if (layout === "overlay") {
    return `${standardVideoFilter(settings)},drawbox=x=0:y=0:w=iw:h=260:color=black@0.68:t=fill,drawtext=text='${quote}':fontcolor=white:fontsize=${fontSize}:line_spacing=14:x=(w-text_w)/2:y=(220-text_h)/2`;
  }
  const quoteHeight = 270;
  const videoHeight = settings.height - quoteHeight;
  const videoY = layout === "quote_bottom" ? 0 : quoteHeight;
  const textY = layout === "quote_bottom" ? videoHeight + `((${quoteHeight}-text_h)/2)` : `(${quoteHeight}-text_h)/2`;
  return `scale=${settings.width}:${videoHeight}:force_original_aspect_ratio=decrease:flags=fast_bilinear,pad=${settings.width}:${settings.height}:(ow-iw)/2:${videoY}:color=#050805,drawtext=text='${quote}':fontcolor=white:fontsize=${fontSize}:line_spacing=14:x=(w-text_w)/2:y=${textY}`;
}

function subtitleFilter(
  platform: PlatformKey,
  settings: PlatformExportSettings,
  subtitlePath: string
): string {
  const safeZone = PLATFORM_SAFE_ZONES[platform];
  const fontSize = settings.height >= 1600 ? 42 : 30;
  const marginV = Math.round((settings.height * safeZone.subtitleBottomPercent) / 100);
  return `subtitles='${escapeSubtitlePath(subtitlePath)}':force_style='Alignment=2,MarginV=${marginV},FontSize=${fontSize},Bold=1,Outline=3,Shadow=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000'`;
}

async function encode(
  input: RenderPlatformVideoInput,
  includeQuoteCard: boolean
): Promise<void> {
  const filters = [
    includeQuoteCard && input.quoteText
      ? quoteCardFilter(input.settings, input.quoteText, input.settings.xQuoteLayout)
      : standardVideoFilter(input.settings),
  ];
  if (input.settings.burnSubtitles && input.subtitlePath) {
    filters.push(subtitleFilter(input.platform, input.settings, input.subtitlePath));
  }

  const args = [
    "-y",
    "-nostdin",
    "-loglevel",
    "error",
    "-i",
    input.inputPath,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-vf",
    filters.join(","),
    "-c:v",
    "libx264",
    "-preset",
    process.env.FFMPEG_RENDER_PRESET?.trim() || "ultrafast",
    "-crf",
    isFfmpegLowMemoryMode() ? "26" : "23",
    "-pix_fmt",
    "yuv420p",
    "-threads",
    String(getFfmpegThreadCount()),
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
  ];
  if (isFfmpegLowMemoryMode()) {
    args.push("-filter_threads", "1", "-max_muxing_queue_size", "1024");
  }
  args.push(input.outputPath);
  await runCommand(getFfmpegPath(), args);
}

export async function renderPlatformVideo(
  input: RenderPlatformVideoInput
): Promise<{ warnings: string[] }> {
  await fs.mkdir(path.dirname(input.outputPath), { recursive: true });
  const warnings: string[] = [];
  const wantsQuote =
    input.platform === "x" && input.settings.xQuoteCard && Boolean(input.quoteText);

  try {
    await encode(input, wantsQuote);
  } catch (error) {
    if (!wantsQuote) throw error;
    warnings.push("Quote-card text could not be burned in; a standard X video was rendered instead.");
    await encode(input, false);
  }

  await runCommand(getFfmpegPath(), [
    "-y",
    "-nostdin",
    "-loglevel",
    "error",
    "-ss",
    "1",
    "-i",
    input.outputPath,
    "-frames:v",
    "1",
    "-vf",
    "scale=1280:-2:flags=fast_bilinear",
    "-q:v",
    "3",
    input.thumbnailPath,
  ]).catch(() => {
    warnings.push("A cover image could not be generated for this export.");
  });

  return { warnings };
}
