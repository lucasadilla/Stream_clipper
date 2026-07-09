import { isFfmpegAvailable, getFfmpegPath, getFfprobePath } from "@/lib/ffmpeg";
import { hasAnyAiKey } from "@/lib/aiProvider";
import { getStorageRoot, ensureDir } from "@/lib/storage";
import { isYtDlpAvailable, getLastYtDlpProbeError } from "@/services/youtubeDownloadService";
import { getYtDlpPathCandidates } from "@/lib/ytDlp";
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
  ffmpegPath: string;
  ffprobePath: string;
  ytDlpPath: string;
  ytDlpPathCandidates: string[];
  ytDlpProbeError: string | null;
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
    const probe = getLastYtDlpProbeError();
    issues.push(
      probe
        ? `yt-dlp not working (tried: ${getYtDlpPathCandidates().join(", ")}): ${probe}`
        : `yt-dlp not found (tried: ${getYtDlpPathCandidates().join(", ")}). Redeploy with the latest Dockerfile.`
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
    ffmpegPath: getFfmpegPath(),
    ffprobePath: getFfprobePath(),
    ytDlpPath: getYtDlpPathCandidates()[0] ?? "yt-dlp",
    ytDlpPathCandidates: getYtDlpPathCandidates(),
    ytDlpProbeError: ytDlp ? null : getLastYtDlpProbeError(),
    issues,
  };
}
