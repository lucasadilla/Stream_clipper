import path from "path";
import { spawn } from "child_process";
import { existsSync, statSync } from "fs";
import { unlink } from "fs/promises";
import {
  extractFastTimelineFrame,
  extractPortraitThumbnailFrame,
} from "@/lib/ffmpeg";
import {
  ensureDir,
  getFramesDir,
  resolveStoragePath,
  fileExists,
  toRelativeStoragePath,
} from "@/lib/storage";
import { ensureClipSourceForRender } from "@/services/clipSourceService";
import { prisma } from "@/lib/db";

const activeThumbnailJobs = new Map<string, Promise<string | null>>();
const CLIP_THUMBNAIL_VERSION = 2;

function clipThumbFilename(clipSuggestionId: string): string {
  return `clip_${clipSuggestionId}_v${CLIP_THUMBNAIL_VERSION}.jpg`;
}

export function clipThumbRelativePath(
  streamSessionId: string,
  clipSuggestionId: string
): string {
  return toRelativeStoragePath(
    path.join(getFramesDir(streamSessionId), clipThumbFilename(clipSuggestionId))
  );
}

export function clipThumbPublicUrl(
  streamSessionId: string,
  clipSuggestionId: string,
  cacheBust?: number
): string | null {
  const relative = clipThumbRelativePath(streamSessionId, clipSuggestionId);
  if (!fileExists(relative)) return null;
  const base = `/api/storage/${relative.replace(/\\/g, "/")}?inline=1`;
  return cacheBust ? `${base}&v=${cacheBust}` : base;
}

/** Stable client URL — hits an endpoint that generates the frame if missing. */
export function clipThumbnailApiUrl(clipSuggestionId: string): string {
  return `/api/clips/${clipSuggestionId}/thumbnail?inline=1`;
}

function validThumbnail(filePath: string): boolean {
  if (!existsSync(filePath)) return false;
  try {
    return statSync(filePath).size >= 1_024;
  } catch {
    return false;
  }
}

function thumbnailPythonExecutable(): string {
  return (
    process.env.FACECAM_PYTHON ||
    process.env.PYTHON_PATH ||
    (process.platform === "win32" ? "python" : "python3")
  );
}

async function selectHighQualityThumbnail(options: {
  inputPath: string;
  outputPath: string;
  candidateTimes: number[];
}): Promise<boolean> {
  return new Promise((resolve) => {
    const script = path.resolve(
      process.cwd(),
      "workers",
      "facecam",
      "select_thumbnail.py"
    );
    const proc = spawn(thumbnailPythonExecutable(), [script], {
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let settled = false;
    const finish = (success: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(success && validThumbnail(options.outputPath));
    };
    const timer = setTimeout(() => {
      proc.kill();
      finish(false);
    }, 45_000);
    proc.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    // The detector can emit native-library diagnostics on stderr. Ignore them;
    // process status and structured stdout determine whether the image is valid.
    proc.stderr.resume();
    proc.stdin.on("error", () => finish(false));
    proc.on("error", () => finish(false));
    proc.on("close", (code) => {
      if (code !== 0) return finish(false);
      try {
        const result = JSON.parse(stdout) as { ok?: boolean };
        finish(result.ok === true);
      } catch {
        finish(false);
      }
    });
    proc.stdin.end(
      JSON.stringify({
        videoPath: options.inputPath,
        outputPath: options.outputPath,
        candidateTimes: options.candidateTimes,
        outputWidth: 720,
        outputHeight: 1280,
        minConfidence: 0.45,
      })
    );
  });
}

async function resolveThumbInput(
  streamSessionId: string,
  startTimeSeconds: number,
  endTimeSeconds: number
): Promise<{ inputPath: string; seekOffsetSeconds: number } | null> {
  const clipSource = await ensureClipSourceForRender(
    streamSessionId,
    startTimeSeconds,
    endTimeSeconds
  );
  const sourceMedia = await prisma.sourceMedia.findUnique({
    where: { id: clipSource.sourceMediaId },
    select: { filePath: true },
  });
  if (!sourceMedia?.filePath || !fileExists(sourceMedia.filePath)) return null;

  return {
    inputPath: resolveStoragePath(sourceMedia.filePath),
    seekOffsetSeconds: clipSource.renderStart - startTimeSeconds,
  };
}

export async function ensureClipSuggestionThumbnail(
  streamSessionId: string,
  clipSuggestionId: string
): Promise<string | null> {
  const key = `${streamSessionId}:${clipSuggestionId}`;
  const active = activeThumbnailJobs.get(key);
  if (active) return active;

  const job = generateClipSuggestionThumbnail(
    streamSessionId,
    clipSuggestionId
  ).finally(() => {
    if (activeThumbnailJobs.get(key) === job) {
      activeThumbnailJobs.delete(key);
    }
  });
  activeThumbnailJobs.set(key, job);
  return job;
}

async function generateClipSuggestionThumbnail(
  streamSessionId: string,
  clipSuggestionId: string
): Promise<string | null> {
  const clip = await prisma.clipSuggestion.findFirst({
    where: { id: clipSuggestionId, streamSessionId },
  });
  if (!clip) return null;

  const framesDir = getFramesDir(streamSessionId);
  await ensureDir(framesDir);
  const dest = path.join(framesDir, clipThumbFilename(clipSuggestionId));
  if (validThumbnail(dest)) {
    return clipThumbPublicUrl(streamSessionId, clipSuggestionId, Date.now());
  }
  await unlink(dest).catch(() => {});

  const input = await resolveThumbInput(
    streamSessionId,
    clip.startTimeSeconds,
    clip.endTimeSeconds
  );
  if (!input) return null;

  const mid = (clip.startTimeSeconds + clip.endTimeSeconds) / 2;
  const raw = clip.rawAiJson;
  const storedFocus =
    raw &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    typeof raw.focusTimeSeconds === "number" &&
    Number.isFinite(raw.focusTimeSeconds) &&
    raw.focusTimeSeconds >= clip.startTimeSeconds &&
    raw.focusTimeSeconds <= clip.endTimeSeconds
      ? raw.focusTimeSeconds
      : null;
  const duration = Math.max(1, clip.endTimeSeconds - clip.startTimeSeconds);
  // Sample the story focus, reaction, and payoff. The selector prioritizes a
  // clear face, then sharpness/exposure, and creates the portrait crop itself.
  const seekTimes = [
    storedFocus,
    clip.startTimeSeconds + duration * 0.68,
    mid || clip.startTimeSeconds + 1,
    clip.startTimeSeconds + duration * 0.35,
    clip.startTimeSeconds + duration * 0.82,
    clip.startTimeSeconds + 1,
    Math.max(clip.startTimeSeconds, clip.endTimeSeconds - 1.25),
  ].filter(
    (value, index, values): value is number =>
      value != null && values.indexOf(value) === index
  );

  const sourceSeekTimes = seekTimes.map((time) =>
    Math.max(0, time + input.seekOffsetSeconds)
  );
  if (
    await selectHighQualityThumbnail({
      inputPath: input.inputPath,
      outputPath: dest,
      candidateTimes: sourceSeekTimes,
    })
  ) {
    return clipThumbPublicUrl(streamSessionId, clipSuggestionId, Date.now());
  }
  await unlink(dest).catch(() => {});

  // Keep FFmpeg as a dependency-light fallback if the local Python detector is
  // unavailable. Use a larger still so the card remains crisp.
  for (const seekTime of sourceSeekTimes) {
    try {
      await extractPortraitThumbnailFrame(
        input.inputPath,
        dest,
        seekTime,
        720,
        1280,
        2
      );
      if (validThumbnail(dest)) {
        return clipThumbPublicUrl(streamSessionId, clipSuggestionId, Date.now());
      }
    } catch {
      // try next
    }
    await unlink(dest).catch(() => {});
    try {
      await extractFastTimelineFrame(input.inputPath, dest, seekTime, 720, 2);
      if (validThumbnail(dest)) {
        return clipThumbPublicUrl(streamSessionId, clipSuggestionId, Date.now());
      }
    } catch {
      // try next seek
    }
    await unlink(dest).catch(() => {});
  }

  return null;
}

export async function ensureClipSuggestionThumbnails(
  streamSessionId: string,
  clipIds: string[]
): Promise<void> {
  // Parallelize a bit — sequential was slow and clients timed out waiting.
  const ids = clipIds.slice(0, 20);
  const concurrency = 2;
  for (let i = 0; i < ids.length; i += concurrency) {
    const wave = ids.slice(i, i + concurrency);
    await Promise.all(
      wave.map((id) =>
        ensureClipSuggestionThumbnail(streamSessionId, id).catch(() => null)
      )
    );
  }
}
