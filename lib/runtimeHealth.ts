import { isFfmpegAvailable } from "@/lib/ffmpeg";
import { hasAnyAiKey } from "@/lib/aiProvider";
import { getStorageRoot, ensureDir } from "@/lib/storage";
import { isYtDlpAvailable } from "@/services/youtubeDownloadService";
import { isWhisperAvailable } from "@/services/whisperTranscription";
import path from "path";
import fs from "fs/promises";

export interface RuntimeHealthReport {
  ok: boolean;
  ffmpeg: boolean;
  ytDlp: boolean;
  aiConfigured: boolean;
  whisperConfigured: boolean;
  storageRoot: string;
  storageWritable: boolean;
  nodeEnv: string;
  issues: string[];
}

export async function getRuntimeHealthReport(): Promise<RuntimeHealthReport> {
  const storageRoot = getStorageRoot();
  let storageWritable = false;
  let storageError: string | undefined;

  try {
    await ensureDir(storageRoot);
    const probe = path.join(storageRoot, ".write_probe");
    await fs.writeFile(probe, "ok");
    await fs.unlink(probe);
    storageWritable = true;
  } catch (err) {
    storageError =
      err instanceof Error ? err.message : "Storage directory is not writable";
  }

  const [ffmpeg, ytDlp] = await Promise.all([
    isFfmpegAvailable(),
    isYtDlpAvailable(),
  ]);

  const issues: string[] = [];
  if (!ffmpeg) {
    issues.push(
      "FFmpeg not found. Install ffmpeg on the server or set FFMPEG_PATH / FFPROBE_PATH."
    );
  }
  if (!ytDlp) {
    issues.push(
      "yt-dlp not found. Install yt-dlp on the server or set YT_DLP_PATH."
    );
  }
  if (!hasAnyAiKey()) {
    issues.push("Set OPENROUTER_API_KEY or OPENAI_API_KEY for transcription.");
  }
  if (!isWhisperAvailable()) {
    issues.push("Whisper provider is not configured.");
  }
  if (!storageWritable) {
    issues.push(storageError ?? "STORAGE_ROOT is not writable.");
  }

  return {
    ok: issues.length === 0,
    ffmpeg,
    ytDlp,
    aiConfigured: hasAnyAiKey(),
    whisperConfigured: isWhisperAvailable(),
    storageRoot,
    storageWritable,
    nodeEnv: process.env.NODE_ENV ?? "development",
    issues,
  };
}
