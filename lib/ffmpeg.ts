import { spawn } from "child_process";
import { existsSync } from "fs";
import path from "path";
import type { RenderFormat } from "@/lib/renderFormat";
import type { CaptionAppearance } from "@/lib/captionAppearance";
import { getFfmpegCaptionForceStyle } from "@/lib/captionAppearance";
import {
  buildVerticalLayoutFilter,
  type ResolvedVerticalLayout,
} from "@/lib/verticalLayoutFilters";

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
  const configured = configuredExecutablePath("FFMPEG_PATH", "");
  if (configured) return configured;

  // The standard Homebrew FFmpeg formula omits libass. Prefer ffmpeg-full when
  // installed so burned captions work locally without per-machine .env edits.
  if (process.platform === "darwin") {
    for (const candidate of [
      "/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg",
      "/usr/local/opt/ffmpeg-full/bin/ffmpeg",
    ]) {
      if (existsSync(candidate)) return candidate;
    }
  }
  return "ffmpeg";
}

export function getFfprobePath(): string {
  const configured = configuredExecutablePath("FFPROBE_PATH", "");
  if (configured) return configured;
  const ffmpegPath = getFfmpegPath();
  if (path.basename(ffmpegPath) === "ffmpeg" && ffmpegPath !== "ffmpeg") {
    const sibling = path.join(path.dirname(ffmpegPath), "ffprobe");
    if (existsSync(sibling)) return sibling;
  }
  return "ffprobe";
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

/** High-quality x264 tuning for final exports (sharper text/edges). */
function x264HighQualityArgs(): string[] {
  if (isFfmpegLowMemoryMode()) return [];
  return ["-x264-params", "aq-mode=3:aq-strength=1.0:psy-rd=1.0,0.15:ref=4"];
}

function x264EncodeArgs(highQuality: boolean): string[] {
  if (isFfmpegLowMemoryMode()) return x264MemoryArgs();
  if (highQuality) return x264HighQualityArgs();
  return [];
}

function parseCrf(value: string | undefined, fallback: number): string {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 51) {
    return String(fallback);
  }
  return String(parsed);
}

/**
 * Encode settings for final exports vs previews.
 * Finals default to high quality (slow/medium + low CRF) so captions stay sharp.
 */
function exportEncodeProfile(options: {
  previewQuality?: boolean;
  highQuality?: boolean;
}): {
  preset: string;
  crf: string;
  audioBitrate: string;
  scaleFlags: string;
} {
  if (options.previewQuality) {
    return {
      preset: "ultrafast",
      crf: "30",
      audioBitrate: "128k",
      scaleFlags: "fast_bilinear",
    };
  }

  const highQuality = options.highQuality !== false;
  const lowMemory = isFfmpegLowMemoryMode();

  if (!highQuality) {
    return {
      preset: renderPreset(),
      crf: lowMemory ? "26" : "24",
      audioBitrate: "128k",
      scaleFlags: "fast_bilinear",
    };
  }

  const preset =
    process.env.FFMPEG_CAPTION_PRESET?.trim() ||
    process.env.FFMPEG_EXPORT_PRESET?.trim() ||
    (lowMemory ? "medium" : "slow");
  const crf = parseCrf(
    process.env.FFMPEG_EXPORT_CRF,
    lowMemory ? 18 : 15
  );

  return {
    preset,
    crf,
    audioBitrate: "256k",
    scaleFlags: "lanczos",
  };
}

export function formatFfmpegProcessError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/no space left on device|enospc|disk.?full/i.test(message)) {
    return (
      "Server storage is full. Delete old sessions from the Sessions list, " +
      "or free space on the Railway volume, then try exporting again."
    );
  }
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

/**
 * Best-effort duration for partial / growing captures where format.duration is N/A.
 */
export async function probeMediaDurationBestEffort(
  filePath: string
): Promise<number> {
  const basic = await probeMedia(filePath);
  if (basic.durationSeconds >= 3) return basic.durationSeconds;

  try {
    const { stdout } = await runCommand(getFfprobePath(), [
      "-v",
      "error",
      "-probesize",
      "100M",
      "-analyzeduration",
      "100M",
      "-show_entries",
      "format=duration:stream=duration",
      "-of",
      "json",
      filePath,
    ]);
    if (!stdout.trim()) return basic.durationSeconds;

    const data = JSON.parse(stdout) as {
      format?: { duration?: string };
      streams?: Array<{ duration?: string }>;
    };
    const formatDur = parseFloat(data.format?.duration ?? "0") || 0;
    const streamDurs = (data.streams ?? []).map(
      (s) => parseFloat(s.duration ?? "0") || 0
    );
    return Math.max(basic.durationSeconds, formatDur, ...streamDurs, 0);
  } catch {
    return basic.durationSeconds;
  }
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

/** Fast check whether a media file contains a video stream. */
export async function hasVideoStream(filePath: string): Promise<boolean> {
  try {
    const { stdout } = await runCommand(getFfprobePath(), [
      "-v",
      "error",
      "-probesize",
      "5000000",
      "-analyzeduration",
      "5000000",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=codec_type",
      "-of",
      "csv=p=0",
      filePath,
    ]);
    return stdout.includes("video");
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
  // Prefer an explicit audio map; optional (`?`) so video-only DASH parts
  // (e.g. yt-dlp source.f299.mp4) return empty samples instead of throwing.
  const { stdout, stderr } = await runCommand(getFfmpegPath(), [
    "-hide_banner",
    "-nostats",
    "-i",
    inputPath,
    "-map",
    "0:a:0?",
    "-vn",
    "-af",
    "aresample=8000,asetnsamples=n=8000:p=1,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-",
    "-f",
    "null",
    "-",
  ]);

  const samples: Array<{ timeSeconds: number; volumeDb: number }> = [];
  // ametadata's file=- output is stdout on current FFmpeg builds. Include
  // stderr as well for compatibility with builds that route filter logs there.
  const lines = `${stdout}\n${stderr}`.split("\n");
  let currentTime = 0;

  for (const line of lines) {
    const timeMatch = line.match(/pts_time:([0-9.]+)/);
    if (timeMatch) currentTime = parseFloat(timeMatch[1]);

    const rmsMatch = line.match(
      /lavfi\.astats\.Overall\.RMS_level=(-?[0-9.]+|-?inf)/i
    );
    if (rmsMatch) {
      const db = /inf/i.test(rmsMatch[1]) ? -60 : parseFloat(rmsMatch[1]);
      samples.push({ timeSeconds: currentTime, volumeDb: db });
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
  // Soft decode only — hwaccel + mjpeg fails intermittently on FFmpeg 8
  // ("Non full-range YUV" / ff_frame_thread_encoder_init).
  const args = [
    "-y",
    "-ss",
    String(Math.max(0, timeSeconds)),
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
    `scale=${width}:-2:flags=fast_bilinear,format=yuvj420p`,
    "-q:v",
    String(quality),
    outputPath,
  ];
  await runCommand(getFfmpegPath(), args);
}

/**
 * Higher-quality single still for filmstrip gap fills / first paint.
 * Slower than the keyframe-only strip path, but one image is worth the cost.
 */
export async function extractSoloTimelineFrame(
  inputPath: string,
  outputPath: string,
  timeSeconds: number,
  width = 320,
  quality = 3
): Promise<void> {
  const args = [
    "-y",
    "-ss",
    String(Math.max(0, timeSeconds)),
    "-i",
    inputPath,
    "-an",
    "-sn",
    "-dn",
    "-frames:v",
    "1",
    "-vf",
    `scale=${width}:-2:flags=lanczos,format=yuvj420p`,
    "-q:v",
    String(quality),
    outputPath,
  ];
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
  // Soft decode only — see extractFastTimelineFrame note on FFmpeg 8 + mjpeg.
  const args = [
    "-y",
    "-ss",
    String(Math.max(0, startSeconds)),
    "-t",
    String(Math.max(1, durationSeconds)),
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
    `fps=1/${intervalSeconds},scale=${width}:-2:flags=fast_bilinear,format=yuvj420p`,
    "-q:v",
    "9",
    "-fps_mode",
    "vfr",
    outputPattern,
  ];
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
  /** Facecam-aware vertical layout (stacked / PiP / subject crop / center crop). */
  verticalLayout?: ResolvedVerticalLayout;
  /** Faster encode preset for low-res preview renders. */
  previewQuality?: boolean;
}

function subtitleFilter(
  subtitlePath: string,
  format: RenderFormat = "vertical",
  outputHeight = 1080,
  appearance?: CaptionAppearance
): string {
  // libavfilter parses this string itself even though spawn() does not use a
  // shell. Use an explicitly named option (required by newer FFmpeg builds)
  // and escape characters that are meaningful inside a filter value. Forward
  // slashes also make the same expression work with Windows drive paths.
  const escapedPath = subtitlePath
    .replace(/\\/g, "/")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'");
  const isAss = /\.ass$/i.test(subtitlePath);
  if (isAss) {
    // ASS already encodes style, karaoke, and animation — do not force_style.
    return `subtitles=filename='${escapedPath}'`;
  }
  const style = getFfmpegCaptionForceStyle(format, outputHeight, appearance);
  return `subtitles=filename='${escapedPath}':force_style='${style}'`;
}

let subtitleFilterAvailable: boolean | null = null;

async function hasSubtitleFilter(): Promise<boolean> {
  if (subtitleFilterAvailable !== null) return subtitleFilterAvailable;
  try {
    const { stdout, stderr } = await runCommand(getFfmpegPath(), [
      "-hide_banner",
      "-filters",
    ]);
    subtitleFilterAvailable = /\bsubtitles\b/.test(`${stdout}\n${stderr}`);
  } catch {
    subtitleFilterAvailable = false;
  }
  return subtitleFilterAvailable;
}

function captionRendererUnavailableError(): Error {
  return new Error(
    "Burned captions were requested, but this FFmpeg build does not include the " +
      "subtitles (libass) filter. Install an FFmpeg build with libass support. " +
      "The Railway Docker image includes and verifies this capability."
  );
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

/**
 * Frame-accurate trim used when captions are burned in.
 * Stream-copy cuts snap to the previous keyframe, which desyncs ASS timing
 * from the speech the editor preview is locked to. Re-encoding with `-ss`
 * after `-i` decodes up to the exact timestamp so t=0 matches the ASS clock.
 */
export async function accurateCutSegment(
  inputPath: string,
  outputPath: string,
  startSeconds: number,
  durationSeconds: number
): Promise<void> {
  const lowMemory = isFfmpegLowMemoryMode();
  await runCommand(getFfmpegPath(), [
    "-y",
    "-nostdin",
    "-loglevel",
    "error",
    "-i",
    inputPath,
    "-ss",
    String(Math.max(0, startSeconds)),
    "-t",
    String(Math.max(0.1, durationSeconds)),
    "-map",
    "0:v:0?",
    "-map",
    "0:a:0?",
    "-c:v",
    "libx264",
    "-preset",
    process.env.FFMPEG_CAPTION_PRESET?.trim() ||
      process.env.FFMPEG_EXPORT_PRESET?.trim() ||
      (lowMemory ? "medium" : "slow"),
    "-crf",
    parseCrf(process.env.FFMPEG_EXPORT_CRF, lowMemory ? 18 : 15),
    "-threads",
    String(getFfmpegThreadCount()),
    ...x264EncodeArgs(true),
    "-c:a",
    "aac",
    "-b:a",
    "256k",
    "-avoid_negative_ts",
    "make_zero",
    "-movflags",
    "+faststart",
    outputPath,
  ]);
}

async function encodeWithFilters(options: {
  inputPath: string;
  outputPath: string;
  vf: string;
  outputHeight: number;
  withAudio: boolean;
  previewQuality?: boolean;
  /** Higher quality for caption burn-in / final exports. */
  highQuality?: boolean;
  startSeconds?: number;
  durationSeconds?: number;
  accurateSeek?: boolean;
}): Promise<void> {
  const highQuality = Boolean(options.highQuality) && !options.previewQuality;
  const profile = exportEncodeProfile({
    previewQuality: options.previewQuality,
    highQuality,
  });
  const lowMemory = isFfmpegLowMemoryMode();

  const args = [
    "-y",
    "-nostdin",
    "-loglevel",
    "error",
  ];

  // Fast coarse seek before input when we don't need frame accuracy.
  if (
    options.startSeconds != null &&
    options.startSeconds > 0 &&
    !options.accurateSeek
  ) {
    args.push("-ss", String(options.startSeconds));
  }

  args.push("-i", options.inputPath);

  // Frame-accurate seek after input (decodes up to the exact timestamp).
  if (
    options.startSeconds != null &&
    options.startSeconds > 0 &&
    options.accurateSeek
  ) {
    args.push("-ss", String(options.startSeconds));
  }
  if (options.durationSeconds != null && options.durationSeconds > 0) {
    args.push("-t", String(options.durationSeconds));
  }

  // After an accurate seek, reset PTS so burned ASS (authored at t=0 = clip
  // start) stays locked to the speech — same clock as a pre-cut segment.
  let vf = options.vf;
  if (
    options.accurateSeek &&
    options.startSeconds != null &&
    options.startSeconds > 0
  ) {
    vf = `setpts=PTS-STARTPTS,${vf}`;
  }

  args.push(
    "-map",
    "0:v:0?",
    "-map",
    "0:a:0?",
    "-sn",
    "-dn",
    "-vf",
    vf,
    "-c:v",
    "libx264",
    "-preset",
    profile.preset,
    "-crf",
    profile.crf,
    "-pix_fmt",
    "yuv420p",
    "-threads",
    String(getFfmpegThreadCount()),
    ...x264EncodeArgs(highQuality)
  );

  if (lowMemory) {
    args.push("-filter_threads", "1", "-max_muxing_queue_size", "1024");
  }

  if (options.withAudio) {
    if (
      options.accurateSeek &&
      options.startSeconds != null &&
      options.startSeconds > 0
    ) {
      args.push("-af", "asetpts=PTS-STARTPTS");
    }
    args.push("-c:a", "aac", "-b:a", profile.audioBitrate);
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
    verticalLayout,
    previewQuality,
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
  const tempFiles: string[] = [];
  const highQuality = !previewQuality;
  const scaleFlags = exportEncodeProfile({
    previewQuality,
    highQuality,
  }).scaleFlags;

  try {
    // Prefer a single encode pass from the source (seek + filters) so captions
    // are not softened by an intermediate re-encode. Low-memory hosts still
    // cut/downscale first to avoid OOM on long 4K sources.
    let encodeInput = inputPath;
    let seekStart: number | undefined = startTimeSeconds;
    let seekDuration: number | undefined = duration;
    let accurateSeek = Boolean(srtPath);

    if (previewQuality || isFfmpegLowMemoryMode()) {
      const tempCut = `${outputPath}.cut.mp4`;
      tempFiles.push(tempCut);
      if (srtPath) {
        await accurateCutSegment(inputPath, tempCut, startTimeSeconds, duration);
      } else {
        await fastCutSegment(inputPath, tempCut, startTimeSeconds, duration);
      }
      const memcapPath = `${outputPath}.memcap.mp4`;
      encodeInput = await maybeDownscaleSourceForMemory(tempCut, memcapPath);
      if (encodeInput !== tempCut) tempFiles.push(encodeInput);
      seekStart = undefined;
      seekDuration = undefined;
      accurateSeek = false;
    }

    const captionsSupported = srtPath ? await hasSubtitleFilter() : false;

    if (format === "native" && srtPath) {
      if (!captionsSupported) {
        throw captionRendererUnavailableError();
      }
      await encodeWithFilters({
        inputPath: encodeInput,
        outputPath,
        vf: subtitleFilter(srtPath, subtitleFormat, outputHeight, captionAppearance),
        outputHeight,
        withAudio: true,
        previewQuality,
        highQuality,
        startSeconds: seekStart,
        durationSeconds: seekDuration,
        accurateSeek,
      });
      return;
    }

    let vf: string;
    if (verticalLayout) {
      const encodeProbe = await probeMedia(encodeInput);
      vf = buildVerticalLayoutFilter(verticalLayout, {
        sourceWidth: encodeProbe.width,
        sourceHeight: encodeProbe.height,
        outputWidth: width,
        outputHeight: height,
      });
    } else {
      switch (layout) {
        case "center_crop":
        case "facecam_overlay":
        case "facecam_top_gameplay_bottom":
        default:
          vf = `scale=${width}:${height}:force_original_aspect_ratio=increase:flags=${scaleFlags},crop=${width}:${height}`;
      }
    }

    if (srtPath && !captionsSupported) {
      throw captionRendererUnavailableError();
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
      previewQuality,
      highQuality,
      startSeconds: seekStart,
      durationSeconds: seekDuration,
      accurateSeek,
    });
  } finally {
    for (const file of tempFiles) {
      await fs.unlink(file).catch(() => {});
    }
  }
}

export async function getFfmpegVersion(): Promise<string | null> {
  try {
    const { stdout, stderr } = await runCommand(getFfmpegPath(), ["-version"]);
    return (stdout || stderr).trim().split(/\r?\n/, 1)[0] || null;
  } catch {
    return null;
  }
}

export interface RenderSequenceSegment {
  startTimeSeconds: number;
  endTimeSeconds: number;
  volume: number;
  muted: boolean;
  fadeInSeconds: number;
  fadeOutSeconds: number;
}

export interface RenderSequenceMediaOverlay {
  inputPath: string;
  type: "image" | "broll";
  startTimeSeconds: number;
  endTimeSeconds: number;
  position: "center" | "top-left" | "top-right" | "bottom-left" | "bottom-right";
  scalePercent: number;
}

export interface RenderSequenceOptions {
  inputPath: string;
  outputPath: string;
  segments: RenderSequenceSegment[];
  format: RenderFormat;
  width: number;
  height: number;
  srtPath?: string;
  captionAppearance?: CaptionAppearance;
  normalizeAudio?: boolean;
  denoiseAudio?: boolean;
  verticalBackground?: "crop" | "blur";
  mediaOverlays?: RenderSequenceMediaOverlay[];
}

function overlayPosition(
  position: RenderSequenceMediaOverlay["position"]
): { x: string; y: string } {
  switch (position) {
    case "top-left":
      return { x: "40", y: "40" };
    case "top-right":
      return { x: "W-w-40", y: "40" };
    case "bottom-left":
      return { x: "40", y: "H-h-40" };
    case "bottom-right":
      return { x: "W-w-40", y: "H-h-40" };
    default:
      return { x: "(W-w)/2", y: "(H-h)/2" };
  }
}

/** Encode and concatenate source ranges into one output timeline. */
export async function renderSequence(options: RenderSequenceOptions): Promise<void> {
  if (options.segments.length === 0) throw new Error("Sequence has no cuts");
  const probe = await probeMedia(options.inputPath);
  const withAudio = Boolean(probe.audioCodec);
  const totalDuration = options.segments.reduce(
    (total, segment) => total + segment.endTimeSeconds - segment.startTimeSeconds,
    0
  );
  if (totalDuration <= 0) throw new Error("Sequence duration is invalid");

  if (options.srtPath && !(await hasSubtitleFilter())) {
    throw captionRendererUnavailableError();
  }

  const overlays = options.mediaOverlays ?? [];
  const args = ["-y", "-nostdin", "-loglevel", "error", "-i", options.inputPath];
  for (const overlay of overlays) {
    if (overlay.type === "image") {
      args.push("-loop", "1", "-i", overlay.inputPath);
    } else {
      args.push("-stream_loop", "-1", "-i", overlay.inputPath);
    }
  }

  const filters: string[] = [];
  const concatInputs: string[] = [];
  const width = Math.max(2, Math.round(options.width / 2) * 2);
  const height = Math.max(2, Math.round(options.height / 2) * 2);

  const profile = exportEncodeProfile({ highQuality: true });
  const scaleFlags = profile.scaleFlags;

  options.segments.forEach((segment, index) => {
    const start = Math.max(0, segment.startTimeSeconds);
    const end = Math.max(start + 0.05, segment.endTimeSeconds);
    const duration = end - start;
    const source = `[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS`;
    if (options.format === "vertical" && options.verticalBackground === "blur") {
      filters.push(`${source},split=2[bg${index}][fg${index}]`);
      filters.push(
        `[bg${index}]scale=${width}:${height}:force_original_aspect_ratio=increase:flags=${scaleFlags},crop=${width}:${height},boxblur=20:2[blur${index}]`
      );
      filters.push(
        `[fg${index}]scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=${scaleFlags}[fit${index}]`
      );
      filters.push(
        `[blur${index}][fit${index}]overlay=(W-w)/2:(H-h)/2,setsar=1,fps=30,format=yuv420p[v${index}]`
      );
    } else {
      filters.push(
        `${source},scale=${width}:${height}:force_original_aspect_ratio=increase:flags=${scaleFlags},crop=${width}:${height},setsar=1,fps=30,format=yuv420p[v${index}]`
      );
    }

    concatInputs.push(`[v${index}]`);
    if (withAudio) {
      const audioFilters = [
        `[0:a]atrim=start=${start}:end=${end}`,
        "asetpts=PTS-STARTPTS",
        `volume=${segment.muted ? 0 : Math.min(2, Math.max(0, segment.volume))}`,
      ];
      const fadeIn = Math.min(duration / 2, Math.max(0, segment.fadeInSeconds));
      const fadeOut = Math.min(duration / 2, Math.max(0, segment.fadeOutSeconds));
      if (fadeIn > 0.01) audioFilters.push(`afade=t=in:st=0:d=${fadeIn}`);
      if (fadeOut > 0.01) {
        audioFilters.push(`afade=t=out:st=${Math.max(0, duration - fadeOut)}:d=${fadeOut}`);
      }
      audioFilters.push("aresample=48000", "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo");
      filters.push(`${audioFilters.join(",")}[a${index}]`);
      concatInputs.push(`[a${index}]`);
    }
  });

  filters.push(
    `${concatInputs.join("")}concat=n=${options.segments.length}:v=1:a=${withAudio ? 1 : 0}[vcat]${withAudio ? "[acat]" : ""}`
  );

  let videoLabel = "vcat";
  if (options.srtPath) {
    filters.push(
      `[${videoLabel}]${subtitleFilter(options.srtPath, options.format, height, options.captionAppearance)}[vsub]`
    );
    videoLabel = "vsub";
  }

  overlays.forEach((overlay, index) => {
    const inputIndex = index + 1;
    const nextLabel = `vov${index}`;
    const prepared = `ov${index}`;
    if (overlay.type === "broll") {
      filters.push(
        `[${inputIndex}:v]setpts=PTS-STARTPTS,scale=${width}:${height}:force_original_aspect_ratio=increase:flags=${scaleFlags},crop=${width}:${height},setsar=1,format=yuv420p[${prepared}]`
      );
      filters.push(
        `[${videoLabel}][${prepared}]overlay=0:0:enable='between(t,${overlay.startTimeSeconds},${overlay.endTimeSeconds})':eof_action=repeat[${nextLabel}]`
      );
    } else {
      const overlayWidth = Math.max(
        40,
        Math.round((width * Math.min(100, Math.max(10, overlay.scalePercent))) / 100)
      );
      const pos = overlayPosition(overlay.position);
      filters.push(
        `[${inputIndex}:v]setpts=PTS-STARTPTS,scale=${overlayWidth}:-2:flags=${scaleFlags},format=rgba[${prepared}]`
      );
      filters.push(
        `[${videoLabel}][${prepared}]overlay=${pos.x}:${pos.y}:enable='between(t,${overlay.startTimeSeconds},${overlay.endTimeSeconds})':eof_action=repeat[${nextLabel}]`
      );
    }
    videoLabel = nextLabel;
  });

  let audioLabel = "acat";
  if (withAudio && (options.denoiseAudio || options.normalizeAudio)) {
    const audioFilters: string[] = [];
    if (options.denoiseAudio) audioFilters.push("afftdn=nf=-25");
    if (options.normalizeAudio) audioFilters.push("loudnorm=I=-16:TP=-1.5:LRA=11");
    filters.push(`[acat]${audioFilters.join(",")}[aout]`);
    audioLabel = "aout";
  }

  args.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    `[${videoLabel}]`
  );
  if (withAudio) args.push("-map", `[${audioLabel}]`);
  args.push(
    "-c:v",
    "libx264",
    "-preset",
    profile.preset,
    "-crf",
    profile.crf,
    "-pix_fmt",
    "yuv420p",
    "-threads",
    String(getFfmpegThreadCount()),
    ...x264EncodeArgs(true)
  );
  if (withAudio) args.push("-c:a", "aac", "-b:a", profile.audioBitrate);
  else args.push("-an");
  if (isFfmpegLowMemoryMode()) {
    args.push("-filter_threads", "1", "-filter_complex_threads", "1", "-max_muxing_queue_size", "1024");
  }
  args.push("-t", String(totalDuration), "-movflags", "+faststart", options.outputPath);
  await runCommand(getFfmpegPath(), args);
}
