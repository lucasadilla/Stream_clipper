import { spawn } from "child_process";
import path from "path";
import type { RenderFormat } from "@/lib/renderFormat";
import type { CaptionAppearance } from "@/lib/captionAppearance";
import { getFfmpegCaptionForceStyle } from "@/lib/captionAppearance";

function isWindowsAbsolutePath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || value.includes("\\");
}

function configuredExecutablePath(envName: string, fallback: string): string {
  const configured = process.env[envName]?.trim();
  if (!configured) return fallback;

  // Railway/Linux deploys sometimes inherit local Windows .env paths. Ignore
  // those so the Docker-installed binaries on PATH still work.
  if (process.platform !== "win32" && isWindowsAbsolutePath(configured)) {
    return fallback;
  }

  return configured;
}

export function getFfmpegPath(): string {
  return configuredExecutablePath("FFMPEG_PATH", "ffmpeg");
}

export function getFfprobePath(): string {
  return configuredExecutablePath("FFPROBE_PATH", "ffprobe");
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Limit ffmpeg RAM on small hosts (Railway hobby, etc.). Default on in production. */
export function isFfmpegLowMemoryMode(): boolean {
  const configured = process.env.FFMPEG_LOW_MEMORY?.trim().toLowerCase();
  if (configured === "1" || configured === "true" || configured === "yes") return true;
  if (configured === "0" || configured === "false" || configured === "no") return false;
  return process.env.NODE_ENV === "production";
}

export function getFfmpegThreadCount(): number {
  const configured = process.env.FFMPEG_THREADS?.trim();
  if (configured) return parsePositiveInt(configured, 1);
  return isFfmpegLowMemoryMode() ? 1 : 0;
}

function getRenderMaxSourceHeight(): number {
  return parsePositiveInt(process.env.RENDER_MAX_SOURCE_HEIGHT?.trim(), 1080);
}

function getRenderVerticalHeight(): number {
  return parsePositiveInt(process.env.RENDER_VERTICAL_HEIGHT?.trim(), 1920);
}

function x264MemoryArgs(): string[] {
  if (!isFfmpegLowMemoryMode()) return [];
  return ["-x264-params", "ref=1:bframes=0:rc-lookahead=10"];
}

export function formatFfmpegProcessError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/out of memory|cannot allocate memory|killed|sigkill|\boom\b/i.test(message)) {
    return (
      "Render ran out of server memory. Try a shorter clip, turn off burned captions, " +
      "or set FFMPEG_LOW_MEMORY=1 and FFMPEG_THREADS=1. On Railway, upgrade RAM if needed."
    );
  }
  return message;
}

export async function isFfmpegAvailable(): Promise<boolean> {
  try {
    await runCommand(getFfmpegPath(), ["-version"]);
    return true;
  } catch {
    return false;
  }
}

export interface MediaProbeResult {
  durationSeconds: number;
  width: number;
  height: number;
  fps: number;
  videoCodec: string | null;
  audioCodec: string | null;
  raw: Record<string, unknown>;
}

export function runCommand(
  command: string,
  args: string[]
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    // Never use shell — on Windows it breaks quoted paths and yt-dlp section globs (*time-time)
    const proc = spawn(command, args, {
      shell: false,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else
        reject(
          new Error(
            `${path.basename(command)} failed (code ${code}): ${stderr || stdout}`
          )
        );
    });
    proc.on("error", reject);
  });
}

export async function probeMedia(filePath: string): Promise<MediaProbeResult> {
  const { stdout } = await runCommand(getFfprobePath(), [
    "-v",
    "quiet",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    filePath,
  ]);

  if (!stdout.trim()) {
    return {
      durationSeconds: 0,
      width: 0,
      height: 0,
      fps: 0,
      videoCodec: null,
      audioCodec: null,
      raw: {},
    };
  }

  let data: {
    format?: { duration?: string };
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      width?: number;
      height?: number;
      r_frame_rate?: string;
      avg_frame_rate?: string;
    }>;
  };
  try {
    data = JSON.parse(stdout) as typeof data;
  } catch {
    return {
      durationSeconds: 0,
      width: 0,
      height: 0,
      fps: 0,
      videoCodec: null,
      audioCodec: null,
      raw: {},
    };
  }

  const videoStream = data.streams?.find((s) => s.codec_type === "video");
  const audioStream = data.streams?.find((s) => s.codec_type === "audio");

  const fpsStr = videoStream?.avg_frame_rate ?? videoStream?.r_frame_rate ?? "30/1";
  const [num, den] = fpsStr.split("/").map(Number);
  const fps = den ? num / den : 30;

  return {
    durationSeconds: parseFloat(data.format?.duration ?? "0"),
    width: videoStream?.width ?? 0,
    height: videoStream?.height ?? 0,
    fps,
    videoCodec: videoStream?.codec_name ?? null,
    audioCodec: audioStream?.codec_name ?? null,
    raw: data as unknown as Record<string, unknown>,
  };
}

/** Fast check whether a media file contains an audio stream (limited probe for growing files). */
export async function hasAudioStream(filePath: string): Promise<boolean> {
  try {
    const { stdout } = await runCommand(getFfprobePath(), [
      "-v",
      "error",
      "-probesize",
      "5000000",
      "-analyzeduration",
      "5000000",
      "-select_streams",
      "a",
      "-show_entries",
      "stream=codec_type",
      "-of",
      "csv=p=0",
      filePath,
    ]);
    return stdout.includes("audio");
  } catch {
    return false;
  }
}

export async function extractAudio(
  inputPath: string,
  outputPath: string
): Promise<void> {
  await runCommand(getFfmpegPath(), [
    "-y",
    "-i",
    inputPath,
    "-vn",
    "-acodec",
    "pcm_s16le",
    "-ar",
    "16000",
    "-ac",
    "1",
    outputPath,
  ]);
}

/** Extract mono 16 kHz WAV for a time range (Whisper-friendly). */
export async function extractAudioSegment(
  inputPath: string,
  outputPath: string,
  startSeconds: number,
  durationSeconds: number,
  options?: { accurateSeek?: boolean }
): Promise<void> {
  const start = String(Math.max(0, startSeconds));
  const duration = String(Math.max(0.1, durationSeconds));
  const accurate = options?.accurateSeek ?? false;

  const args = ["-y"];
  if (!accurate) {
    args.push("-ss", start);
  }
  args.push("-i", inputPath);
  if (accurate) {
    args.push("-ss", start);
  }
  args.push(
    "-t",
    duration,
    "-vn",
    "-acodec",
    "pcm_s16le",
    "-ar",
    "16000",
    "-ac",
    "1",
    outputPath
  );

  await runCommand(getFfmpegPath(), args);
}

/** Extract volume levels per second using FFmpeg astats/volumedetect approach */
export async function analyzeAudioVolume(
  inputPath: string
): Promise<Array<{ timeSeconds: number; volumeDb: number }>> {
  // Use ffmpeg to output per-frame volume via astats
  const { stderr } = await runCommand(getFfmpegPath(), [
    "-i",
    inputPath,
    "-af",
    "astats=metadata=1:reset=1,ametadata=print:file=-",
    "-f",
    "null",
    "-",
  ]);

  const samples: Array<{ timeSeconds: number; volumeDb: number }> = [];
  const lines = stderr.split("\n");
  let currentTime = 0;

  for (const line of lines) {
    const timeMatch = line.match(/pts_time:([0-9.]+)/);
    if (timeMatch) currentTime = parseFloat(timeMatch[1]);

    const rmsMatch = line.match(/RMS level dB: (-?[0-9.]+|inf)/);
    if (rmsMatch) {
      const db = rmsMatch[1] === "inf" ? -60 : parseFloat(rmsMatch[1]);
      samples.push({ timeSeconds: currentTime, volumeDb: db });
    }
  }

  // Fallback: sample every 2 seconds with volumedetect on segments
  if (samples.length === 0) {
    const probe = await probeMedia(inputPath);
    const duration = probe.durationSeconds;
    for (let t = 0; t < duration; t += 2) {
      try {
        const { stderr: segErr } = await runCommand(getFfmpegPath(), [
          "-ss",
          String(t),
          "-t",
          "2",
          "-i",
          inputPath,
          "-af",
          "volumedetect",
          "-f",
          "null",
          "-",
        ]);
        const meanMatch = segErr.match(/mean_volume: (-?[0-9.]+) dB/);
        samples.push({
          timeSeconds: t,
          volumeDb: meanMatch ? parseFloat(meanMatch[1]) : -30,
        });
      } catch {
        samples.push({ timeSeconds: t, volumeDb: -30 });
      }
    }
  }

  return samples;
}

export async function extractFrameAt(
  inputPath: string,
  outputPath: string,
  timeSeconds: number
): Promise<void> {
  await extractFastTimelineFrame(inputPath, outputPath, timeSeconds, 160, 5);
}

/** One keyframe grab — ~1s, used for instant live-edge / head thumbnails. */
export async function extractFastTimelineFrame(
  inputPath: string,
  outputPath: string,
  timeSeconds: number,
  width = 96,
  quality = 9
): Promise<void> {
  const args = ["-y", "-ss", String(Math.max(0, timeSeconds))];
  if (process.platform === "win32" || process.platform === "darwin") {
    args.push("-hwaccel", "auto");
  }
  args.push(
    "-skip_frame",
    "nokey",
    "-i",
    inputPath,
    "-an",
    "-sn",
    "-dn",
    "-frames:v",
    "1",
    "-vf",
    `scale=${width}:-2:flags=fast_bilinear`,
    "-q:v",
    String(quality),
    outputPath
  );
  await runCommand(getFfmpegPath(), args);
}

/**
 * Extract a strip of tiny timeline thumbnails in ONE ffmpeg pass.
 * Decodes keyframes only (`-skip_frame nokey`), so it runs ~70x faster than
 * per-frame seeking and produces ~3 KB images at the given width.
 */
export async function extractThumbnailStrip(
  inputPath: string,
  outputPattern: string,
  startSeconds: number,
  durationSeconds: number,
  intervalSeconds: number,
  width = 96
): Promise<void> {
  const args = [
    "-y",
    "-ss",
    String(Math.max(0, startSeconds)),
    "-t",
    String(Math.max(1, durationSeconds)),
  ];
  if (process.platform === "win32" || process.platform === "darwin") {
    args.push("-hwaccel", "auto");
  }
  args.push(
    "-skip_frame",
    "nokey",
    "-i",
    inputPath,
    "-an",
    "-sn",
    "-dn",
    "-threads",
    "0",
    "-vf",
    `fps=1/${intervalSeconds},scale=${width}:-2:flags=fast_bilinear`,
    "-q:v",
    "9",
    "-fps_mode",
    "vfr",
    outputPattern
  );
  await runCommand(getFfmpegPath(), args);
}

export async function extractFrames(
  inputPath: string,
  outputDir: string,
  intervalSeconds = 2
): Promise<string[]> {
  const pattern = path.join(outputDir, "frame_%06d.jpg");
  await runCommand(getFfmpegPath(), [
    "-y",
    "-i",
    inputPath,
    "-vf",
    `fps=1/${intervalSeconds}`,
    "-q:v",
    "2",
    pattern,
  ]);

  const fs = await import("fs/promises");
  const files = await fs.readdir(outputDir);
  return files
    .filter((f) => f.startsWith("frame_") && f.endsWith(".jpg"))
    .sort()
    .map((f) => path.join(outputDir, f));
}

export interface RenderShortOptions {
  inputPath: string;
  outputPath: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  format?: RenderFormat;
  layout: "center_crop" | "facecam_overlay" | "facecam_top_gameplay_bottom" | "gameplay_full";
  width?: number;
  height?: number;
  fps?: number;
  srtPath?: string;
  subtitleFormat?: RenderFormat;
  outputHeight?: number;
  captionAppearance?: CaptionAppearance;
  facecamRegion?: { x: number; y: number; width: number; height: number };
}

function subtitleFilter(
  srtPath: string,
  format: RenderFormat = "vertical",
  outputHeight = 1080,
  appearance?: CaptionAppearance
): string {
  const escapedSrt = srtPath.replace(/\\/g, "/").replace(/:/g, "\\:");
  const style = getFfmpegCaptionForceStyle(format, outputHeight, appearance);
  return `subtitles='${escapedSrt}':force_style='${style}'`;
}

function renderPreset(): string {
  return process.env.FFMPEG_RENDER_PRESET?.trim() || "ultrafast";
}

/** Fast stream-copy trim — seek before input for large files. */
export async function fastCutSegment(
  inputPath: string,
  outputPath: string,
  startSeconds: number,
  durationSeconds: number
): Promise<void> {
  await runCommand(getFfmpegPath(), [
    "-y",
    "-nostdin",
    "-loglevel",
    "error",
    "-ss",
    String(Math.max(0, startSeconds)),
    "-i",
    inputPath,
    "-t",
    String(Math.max(0.1, durationSeconds)),
    "-map",
    "0:v:0?",
    "-map",
    "0:a:0?",
    "-c",
    "copy",
    "-avoid_negative_ts",
    "make_zero",
    outputPath,
  ]);
}

async function encodeWithFilters(options: {
  inputPath: string;
  outputPath: string;
  vf: string;
  outputHeight: number;
  withAudio: boolean;
}): Promise<void> {
  const lowMemory = isFfmpegLowMemoryMode();
  const args = [
    "-y",
    "-nostdin",
    "-loglevel",
    "error",
    "-i",
    options.inputPath,
    "-map",
    "0:v:0?",
    "-map",
    "0:a:0?",
    "-sn",
    "-dn",
    "-vf",
    options.vf,
    "-c:v",
    "libx264",
    "-preset",
    renderPreset(),
    "-crf",
    lowMemory ? "26" : "24",
    "-threads",
    String(getFfmpegThreadCount()),
    ...x264MemoryArgs(),
  ];

  if (lowMemory) {
    args.push("-filter_threads", "1", "-max_muxing_queue_size", "1024");
  }

  if (options.withAudio) {
    args.push("-c:a", "aac", "-b:a", "128k");
  } else {
    args.push("-an");
  }

  args.push("-movflags", "+faststart", options.outputPath);
  await runCommand(getFfmpegPath(), args);
}

/** Downscale 4K+ cuts before vertical encode to avoid OOM on small containers. */
async function maybeDownscaleSourceForMemory(
  inputPath: string,
  outputPath: string
): Promise<string> {
  if (!isFfmpegLowMemoryMode()) return inputPath;

  let probe: MediaProbeResult;
  try {
    probe = await probeMedia(inputPath);
  } catch {
    return inputPath;
  }

  const maxHeight = getRenderMaxSourceHeight();
  const maxWidth = maxHeight * 2;
  if (probe.height <= maxHeight && probe.width <= maxWidth) {
    return inputPath;
  }

  await encodeWithFilters({
    inputPath,
    outputPath,
    vf: `scale=-2:${maxHeight}:flags=fast_bilinear`,
    outputHeight: maxHeight,
    withAudio: true,
  });
  return outputPath;
}

export async function renderShort(options: RenderShortOptions): Promise<void> {
  const {
    inputPath,
    outputPath,
    startTimeSeconds,
    endTimeSeconds,
    format = "vertical",
    layout,
    width: widthOption,
    height: heightOption,
    srtPath,
    subtitleFormat = format,
    outputHeight: outputHeightOption,
    captionAppearance,
  } = options;

  const verticalHeight = getRenderVerticalHeight();
  const verticalWidth = Math.round((verticalHeight * 9) / 16);
  const width = widthOption ?? (format === "vertical" ? verticalWidth : 1080);
  const height = heightOption ?? (format === "vertical" ? verticalHeight : 1920);
  const outputHeight =
    outputHeightOption ?? (format === "vertical" ? height : 1080);

  const duration = endTimeSeconds - startTimeSeconds;
  if (duration <= 0) throw new Error("Invalid clip duration");

  const needsReencode = format === "vertical" || !!srtPath;

  if (!needsReencode) {
    await fastCutSegment(inputPath, outputPath, startTimeSeconds, duration);
    return;
  }

  const fs = await import("fs/promises");
  const tempCut = `${outputPath}.cut.mp4`;
  const tempFiles = [tempCut];

  try {
    await fastCutSegment(inputPath, tempCut, startTimeSeconds, duration);

    const memcapPath = `${outputPath}.memcap.mp4`;
    const encodeInput = await maybeDownscaleSourceForMemory(tempCut, memcapPath);
    if (encodeInput !== tempCut) tempFiles.push(encodeInput);

    if (format === "native" && srtPath) {
      await encodeWithFilters({
        inputPath: encodeInput,
        outputPath,
        vf: subtitleFilter(srtPath, subtitleFormat, outputHeight, captionAppearance),
        outputHeight,
        withAudio: true,
      });
      return;
    }

    let vf: string;
    switch (layout) {
      case "center_crop":
      case "facecam_overlay":
      case "facecam_top_gameplay_bottom":
      default:
        vf = `scale=${width}:${height}:force_original_aspect_ratio=increase:flags=fast_bilinear,crop=${width}:${height}`;
    }

    if (srtPath) {
      vf += `,${subtitleFilter(srtPath, subtitleFormat, height, captionAppearance)}`;
    }

    await encodeWithFilters({
      inputPath: encodeInput,
      outputPath,
      vf,
      outputHeight: height,
      withAudio: true,
    });
  } finally {
    for (const file of tempFiles) {
      await fs.unlink(file).catch(() => {});
    }
  }
}
