import path from "path";
import { existsSync } from "fs";
import { type ChildProcess, spawn } from "child_process";
import { hasAudioStream } from "@/lib/ffmpeg";
import {
  ensureDir,
  getUploadDir,
  listSourceCandidateFiles,
} from "@/lib/storage";
import {
  baseYtDlpArgs,
  getYtDlpDeploymentArgs,
  resolveYtDlpInvocation,
  detectDownloadPlatform,
} from "@/services/youtubeDownloadService";

/** Detached bestaudio capture when the primary file is video-only DASH. */
const activeCompanionAudio = new Map<string, ChildProcess>();
const companionAttemptAt = new Map<string, number>();

const COMPANION_RETRY_MS = 30_000;
const COMPANION_OUTPUT = "source.audio.m4a";

/**
 * Find an existing audio-capable source file in the upload dir.
 */
export async function findExistingAudioSource(
  streamSessionId: string
): Promise<string | null> {
  const uploadDir = getUploadDir(streamSessionId);
  const candidates = await listSourceCandidateFiles(uploadDir);
  for (const file of candidates) {
    if (await hasAudioStream(file)) return file;
  }
  return null;
}

/**
 * Ensure Whisper has an audio track when the primary capture is video-only
 * (common with YouTube DASH e.g. f299 / f303).
 *
 * Always fire-and-forget: never block the HTTP request. Live URLs and long
 * VODs would hang forever if we awaited yt-dlp here, which also stuck the
 * client `transcribeInFlight` flag and stopped all further polls.
 */
export async function ensureCompanionAudioTrack(
  streamSessionId: string,
  youtubeUrl: string,
  options?: { isLive?: boolean; liveFromStart?: boolean }
): Promise<string | null> {
  const existing = await findExistingAudioSource(streamSessionId);
  if (existing) return existing;

  const uploadDir = getUploadDir(streamSessionId);
  await ensureDir(uploadDir);
  const outputPath = path.join(uploadDir, COMPANION_OUTPUT);

  startCompanionAudioDownload(streamSessionId, youtubeUrl, outputPath, {
    isLive: options?.isLive,
    // Transcription retries should not require VOD-from-start (Twitch often
    // has none). Explicit liveFromStart from live capture still wins.
    liveFromStart: options?.liveFromStart ?? false,
  });

  // Growing / mid-download file may not probe yet — next poll picks it up.
  if (existsSync(outputPath) && (await hasAudioStream(outputPath))) {
    return outputPath;
  }
  return findExistingAudioSource(streamSessionId);
}

/**
 * Kick off companion audio as soon as live capture starts (don't wait for
 * the first Whisper poll to discover a video-only file).
 */
export function startCompanionAudioForSession(
  streamSessionId: string,
  youtubeUrl: string,
  options?: { isLive?: boolean; liveFromStart?: boolean }
): void {
  const outputPath = path.join(
    getUploadDir(streamSessionId),
    COMPANION_OUTPUT
  );
  void ensureDir(getUploadDir(streamSessionId)).then(() => {
    startCompanionAudioDownload(streamSessionId, youtubeUrl, outputPath, {
      isLive: options?.isLive ?? true,
      liveFromStart: options?.liveFromStart,
    });
  });
}

function startCompanionAudioDownload(
  streamSessionId: string,
  youtubeUrl: string,
  outputPath: string,
  options?: { isLive?: boolean; liveFromStart?: boolean }
): void {
  const existingProc = activeCompanionAudio.get(streamSessionId);
  if (existingProc && !existingProc.killed) return;

  const last = companionAttemptAt.get(streamSessionId) ?? 0;
  if (Date.now() - last < COMPANION_RETRY_MS && !existsSync(outputPath)) {
    return;
  }
  companionAttemptAt.set(streamSessionId, Date.now());

  void (async () => {
    const invocation = await resolveYtDlpInvocation();
    if (!invocation) return;

    try {
      const platform = detectDownloadPlatform(youtubeUrl);
      const liveFromStart = options?.liveFromStart ?? Boolean(options?.isLive);
      const args = [
        ...invocation.prefixArgs,
        ...(await getYtDlpDeploymentArgs(platform)),
        ...baseYtDlpArgs({ platform, url: youtubeUrl }),
        ...(options?.isLive
          ? liveFromStart
            ? ["--live-from-start"]
            : ["--no-live-from-start"]
          : []),
        "-f",
        "bestaudio/best",
        "--no-part",
        "-o",
        outputPath,
        youtubeUrl,
      ];
      const proc = spawn(invocation.command, args, {
        detached: true,
        stdio: ["ignore", "ignore", "ignore"],
        shell: false,
        windowsHide: true,
      });
      proc.unref();
      activeCompanionAudio.set(streamSessionId, proc);
      proc.on("exit", () => {
        if (activeCompanionAudio.get(streamSessionId) === proc) {
          activeCompanionAudio.delete(streamSessionId);
        }
      });
    } catch {
      // next poll retries after COMPANION_RETRY_MS
    }
  })();
}

export function clearCompanionAudioState(streamSessionId: string): void {
  const proc = activeCompanionAudio.get(streamSessionId);
  if (proc && !proc.killed) {
    try {
      proc.kill();
    } catch {
      // ignore
    }
  }
  activeCompanionAudio.delete(streamSessionId);
  companionAttemptAt.delete(streamSessionId);
}
