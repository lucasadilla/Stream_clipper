import { spawn } from "child_process";
import path from "path";
import type { RenderFormat } from "@/lib/renderFormat";

export function getFfmpegPath(): string {
  return process.env.FFMPEG_PATH ?? "ffmpeg";
}

export function getFfprobePath(): string {
  return process.env.FFPROBE_PATH ?? "ffprobe";
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
  durationSeconds: number
): Promise<void> {
  await runCommand(getFfmpegPath(), [
    "-y",
    "-ss",
    String(Math.max(0, startSeconds)),
    "-t",
    String(Math.max(0.1, durationSeconds)),
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
  await runCommand(getFfmpegPath(), [
    "-y",
    "-ss",
    String(Math.max(0, timeSeconds)),
    "-i",
    inputPath,
    "-frames:v",
    "1",
    "-q:v",
    "3",
    outputPath,
  ]);
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
  facecamRegion?: { x: number; y: number; width: number; height: number };
}

function subtitleFilter(srtPath: string): string {
  const escapedSrt = srtPath.replace(/\\/g, "/").replace(/:/g, "\\:");
  return `subtitles='${escapedSrt}':force_style='FontSize=24,PrimaryColour=&HFFFFFF,OutlineColour=&H000000,Outline=2,Alignment=2,MarginV=80'`;
}

export async function renderShort(options: RenderShortOptions): Promise<void> {
  const {
    inputPath,
    outputPath,
    startTimeSeconds,
    endTimeSeconds,
    format = "vertical",
    layout,
    width = 1080,
    height = 1920,
    fps = 30,
    srtPath,
  } = options;

  const duration = endTimeSeconds - startTimeSeconds;
  if (duration <= 0) throw new Error("Invalid clip duration");

  if (format === "native") {
    if (srtPath) {
      const args = [
        "-y",
        "-ss",
        String(startTimeSeconds),
        "-t",
        String(duration),
        "-i",
        inputPath,
        "-vf",
        subtitleFilter(srtPath),
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "23",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        outputPath,
      ];
      await runCommand(getFfmpegPath(), args);
      return;
    }

    const args = [
      "-y",
      "-ss",
      String(startTimeSeconds),
      "-t",
      String(duration),
      "-i",
      inputPath,
      "-c",
      "copy",
      "-avoid_negative_ts",
      "make_zero",
      outputPath,
    ];
    await runCommand(getFfmpegPath(), args);
    return;
  }

  let vf: string;

  switch (layout) {
    case "center_crop":
      vf = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`;
      break;
    case "facecam_overlay":
    case "facecam_top_gameplay_bottom":
      vf = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`;
      break;
    default:
      vf = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`;
  }

  if (srtPath) {
    vf += `,${subtitleFilter(srtPath)}`;
  }

  const args = [
    "-y",
    "-ss",
    String(startTimeSeconds),
    "-t",
    String(duration),
    "-i",
    inputPath,
    "-vf",
    vf,
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "23",
    "-r",
    String(fps),
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    outputPath,
  ];

  await runCommand(getFfmpegPath(), args);
}
