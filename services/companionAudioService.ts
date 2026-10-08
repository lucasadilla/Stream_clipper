import { youtubeCaptureRetryAt, recordYoutubeCaptureChallenge, clearYoutubeCaptureChallenge } from "@/lib/youtubeCaptureBackoff";
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
  acquireYtDlpDeploymentLease,
  preferredBestAudio,
  resolveYtDlpInvocation,
  detectDownloadPlatform,
  isLiveFromStartUnavailable,
  markYoutubeCookiesRejected,
  classifyYtDlpError,
} from "@/services/youtubeDownloadService";

/** Detached bestaudio capture when the primary file is video-only DASH. */
const activeCompanionAudio = new Map<string, ChildProcess>();
const companionAttemptAt = new Map<string, number>();
const companionErrors = new Map<string, string>();
const companionEdgeFallbackDone = new Set<string>();

const COMPANION_RETRY_MS = 30_000;
const COMPANION_OUTPUT = "source.audio.m4a";

function rememberCompanionError(streamSessionId: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  companionErrors.set(streamSessionId, message.slice(-8_000));
  console.warn(`[companion-audio] ${streamSessionId}: ${message}`);
}

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
  options?: {
    isLive?: boolean;
    liveFromStart?: boolean;
    youtubeExtractorArgs?: string | null;
    includeYoutubeCookies?: boolean;
  }
): void {
  const outputPath = path.join(
    getUploadDir(streamSessionId),
    COMPANION_OUTPUT
  );
  void ensureDir(getUploadDir(streamSessionId)).then(() => {
    startCompanionAudioDownload(streamSessionId, youtubeUrl, outputPath, {
      isLive: options?.isLive ?? true,
      liveFromStart: options?.liveFromStart,
      youtubeExtractorArgs: options?.youtubeExtractorArgs,
      includeYoutubeCookies: options?.includeYoutubeCookies,
    });
  });
}

function startCompanionAudioDownload(
  streamSessionId: string,
  youtubeUrl: string,
  outputPath: string,
  options?: {
    isLive?: boolean;
    liveFromStart?: boolean;
    youtubeExtractorArgs?: string | null;
    includeYoutubeCookies?: boolean;
  }
): void {
  const existingProc = activeCompanionAudio.get(streamSessionId);
  if (existingProc && !existingProc.killed) return;

  // A separate session for the same video must not restart blocked traffic.
  if (youtubeCaptureRetryAt(youtubeUrl, true)) return;

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
      const deploymentLease = await acquireYtDlpDeploymentLease(platform, {
        includeCookies: options?.includeYoutubeCookies,
      });
      const args = [
        ...invocation.prefixArgs,
        ...deploymentLease.args,
        ...(options && "youtubeExtractorArgs" in options
          ? baseYtDlpArgs({
              platform,
              url: youtubeUrl,
              youtubeExtractorArgs: options.youtubeExtractorArgs,
            })
          : baseYtDlpArgs({ platform, url: youtubeUrl })),
        ...(options?.isLive
          ? liveFromStart
            ? ["--live-from-start"]
            : ["--no-live-from-start"]
          : []),
        "-f",
        // Keep this audio-only. Falling back to bare `best` can download a
        // second video-only DASH stream and leave transcription stuck forever.
        `${preferredBestAudio("[ext=m4a]")}/${preferredBestAudio()}`,
        "--no-part",
        "-o",
        outputPath,
        youtubeUrl,
      ];
      let proc: ChildProcess;
      try {
        proc = spawn(invocation.command, args, {
          detached: true,
          stdio: ["ignore", "ignore", "pipe"],
          shell: false,
          windowsHide: true,
        });
      } catch (error) {
        await deploymentLease.release();
        throw error;
      }
      proc.once("close", () => {
        void deploymentLease.release();
      });
      companionErrors.delete(streamSessionId);
      proc.stderr?.setEncoding("utf8");
      proc.stderr?.on("data", (chunk: string) => {
        const previous = companionErrors.get(streamSessionId) ?? "";
        const detail = `${previous}${chunk}`.slice(-8_000);
        companionErrors.set(streamSessionId, detail);
        if (platform === "youtube") markYoutubeCookiesRejected(detail);
      });
      proc.unref();
      activeCompanionAudio.set(streamSessionId, proc);
      proc.on("exit", (code) => {
        if (activeCompanionAudio.get(streamSessionId) === proc) {
          activeCompanionAudio.delete(streamSessionId);
        }
        const detail = companionErrors.get(streamSessionId) ?? "";
        if (platform === "youtube") {
          if (code === 0) clearYoutubeCaptureChallenge(youtubeUrl);
          else if (classifyYtDlpError(detail) === "bot_verification") {
            recordYoutubeCaptureChallenge(youtubeUrl);
          }
        }
        if (code !== 0) {
          console.warn(
            `[companion-audio] ${streamSessionId}: yt-dlp exited with code ${code}${
              detail.trim() ? `: ${detail.trim()}` : ""
            }`
          );
        }
        if (
          code !== 0 &&
          options?.isLive &&
          liveFromStart &&
          !companionEdgeFallbackDone.has(streamSessionId) &&
          isLiveFromStartUnavailable(detail)
        ) {
          companionEdgeFallbackDone.add(streamSessionId);
          companionAttemptAt.delete(streamSessionId);
          console.warn(
            `[companion-audio] live-from-start failed for ${streamSessionId}; retrying from live edge`
          );
          startCompanionAudioDownload(streamSessionId, youtubeUrl, outputPath, {
            isLive: true,
            liveFromStart: false,
            youtubeExtractorArgs: options?.youtubeExtractorArgs,
            includeYoutubeCookies: options?.includeYoutubeCookies,
          });
        }
      });
    } catch (error) {
      rememberCompanionError(streamSessionId, error);
      // The next poll retries after COMPANION_RETRY_MS.
    }
  })();
}

export function clearCompanionAudioState(streamSessionId: string): void {
  const proc = activeCompanionAudio.get(streamSessionId);
  if (proc && !proc.killed) {
    try {
      if (proc.pid) {
        try {
          process.kill(-proc.pid, "SIGTERM");
        } catch {
          proc.kill();
        }
      } else {
        proc.kill();
      }
    } catch {
      // ignore
    }
  }
  activeCompanionAudio.delete(streamSessionId);
  companionAttemptAt.delete(streamSessionId);
  companionErrors.delete(streamSessionId);
  companionEdgeFallbackDone.delete(streamSessionId);
}
