import path from "path";
import fs from "fs/promises";
import { prisma } from "@/lib/db";
import { runCommand, getFfmpegPath } from "@/lib/ffmpeg";
import { probeMedia } from "@/lib/ffmpeg";
import { toJsonValue } from "@/lib/utils";
import {
  getUploadDir,
  ensureDir,
  toRelativeStoragePath,
  findBestSourceFileInDir,
  fileExists,
} from "@/lib/storage";
import { getYtDlpInvocationCandidates, type YtDlpInvocation } from "@/lib/ytDlp";

export { getYtDlpPath } from "@/lib/ytDlp";

let resolvedYtDlpInvocation: YtDlpInvocation | null = null;
let lastYtDlpProbeError: string | null = null;
let generatedCookiesPath: string | null = null;

export function getLastYtDlpProbeError(): string | null {
  return lastYtDlpProbeError;
}

async function probeYtDlpInvocation(
  invocation: YtDlpInvocation
): Promise<boolean> {
  try {
    await runCommand(invocation.command, [...invocation.prefixArgs, "--version"]);
    return true;
  } catch (err) {
    lastYtDlpProbeError =
      err instanceof Error ? err.message : "yt-dlp probe failed";
    return false;
  }
}

export async function resolveYtDlpInvocation(): Promise<YtDlpInvocation | null> {
  if (resolvedYtDlpInvocation) return resolvedYtDlpInvocation;

  for (const invocation of getYtDlpInvocationCandidates()) {
    if (await probeYtDlpInvocation(invocation)) {
      resolvedYtDlpInvocation = invocation;
      lastYtDlpProbeError = null;
      return invocation;
    }
  }

  return null;
}

function getFfmpegLocationDir(): string {
  const ffmpegPath = getFfmpegPath();
  const dir = path.dirname(ffmpegPath);
  if (!dir || dir === "." || dir === path.parse(ffmpegPath).root) {
    return process.cwd();
  }
  return dir;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isTransientYtDlpError(message: string): boolean {
  return /getaddrinfo failed|Failed to resolve|Temporary failure|timed out|Connection reset|TransportError|Network is unreachable|Name or service not known/i.test(
    message
  );
}

export function networkYtDlpArgs(): string[] {
  const args: string[] = [];
  if (process.env.YT_DLP_FORCE_IPV4 !== "0") {
    args.push("--force-ipv4");
  }
  const timeout = process.env.YT_DLP_SOCKET_TIMEOUT?.trim();
  if (timeout) {
    args.push("--socket-timeout", timeout);
  }
  return args;
}

export function baseYtDlpArgs(): string[] {
  return [
    ...networkYtDlpArgs(),
    // Expose growing media files immediately so transcription and timeline
    // thumbnails do not wait for a multi-hour VOD download to finish.
    "--no-part",
    "--js-runtimes",
    getYtDlpJsRuntimeArg(),
    "--no-playlist",
    "--ffmpeg-location",
    getFfmpegLocationDir(),
  ];
}

/** Optional Railway egress/auth settings for datacenter-blocked media hosts. */
export async function getYtDlpDeploymentArgs(): Promise<string[]> {
  const args: string[] = [];
  const proxy = process.env.YT_DLP_PROXY?.trim();
  if (proxy) args.push("--proxy", proxy);

  let cookiesPath = process.env.YT_DLP_COOKIES_PATH?.trim();
  const cookiesBase64 = process.env.YT_DLP_COOKIES_B64?.trim();
  if (!cookiesPath && cookiesBase64) {
    cookiesPath = generatedCookiesPath ?? "/tmp/stream-clipper-ytdlp-cookies.txt";
    if (!generatedCookiesPath) {
      await fs.writeFile(cookiesPath, Buffer.from(cookiesBase64, "base64"), {
        mode: 0o600,
      });
      generatedCookiesPath = cookiesPath;
    }
  }
  if (cookiesPath) args.push("--cookies", cookiesPath);

  return args;
}

export async function runYtDlp(
  extraArgs: string[],
  url: string,
  options?: { retries?: number }
): Promise<{ stdout: string; stderr: string }> {
  const invocation = await resolveYtDlpInvocation();
  if (!invocation) {
    throw new Error(
      lastYtDlpProbeError ??
        "yt-dlp is not installed. Redeploy with the latest Dockerfile or set YT_DLP_PATH."
    );
  }

  const retries = Math.max(1, options?.retries ?? 3);
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const deploymentArgs = await getYtDlpDeploymentArgs();
      return await runCommand(invocation.command, [
        ...invocation.prefixArgs,
        ...deploymentArgs,
        ...extraArgs,
        url,
      ]);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const transient = isTransientYtDlpError(lastError.message);
      if (!transient || attempt === retries - 1) {
        throw lastError;
      }
      await delay(600 * (attempt + 1));
    }
  }

  throw lastError ?? new Error("yt-dlp failed");
}

function getYtDlpJsRuntimeArg(): string {
  const configured = process.env.YT_DLP_JS_RUNTIME;
  if (configured) return configured;
  return `node:${process.execPath}`;
}

function sourceMaxHeight(): number {
  const configured = Number.parseInt(
    process.env.SOURCE_MAX_HEIGHT?.trim() ?? "",
    10
  );
  if (Number.isFinite(configured) && configured >= 240) return configured;
  // Railway only needs a lightweight analysis/editing copy. Final render
  // segments can still be fetched separately at higher quality.
  return process.env.NODE_ENV === "production" ? 480 : 1080;
}

function sourceFormatChains(): string[] {
  const height = sourceMaxHeight();
  return [
    `best[height<=${height}][ext=mp4]/best[height<=${height}]/bestvideo[height<=${height}]+bestaudio`,
    `bestvideo[height<=${height}]+bestaudio/best[height<=${height}]`,
    "bestvideo+bestaudio/best",
    "best",
  ];
}

async function runYtDlpWithFormatFallback(
  baseArgs: string[],
  url: string,
  formats = sourceFormatChains()
): Promise<void> {
  let lastError: Error | null = null;

  for (const format of formats) {
    const args = [...baseArgs];
    const formatIdx = args.indexOf("-f");
    if (formatIdx >= 0) {
      args[formatIdx + 1] = format;
    } else {
      args.unshift("-f", format);
    }

    if (format.includes("+") && !args.includes("--merge-output-format")) {
      const oIdx = args.indexOf("-o");
      if (oIdx >= 0) {
        args.splice(oIdx, 0, "--merge-output-format", "mp4");
      } else {
        args.push("--merge-output-format", "mp4");
      }
    }

    try {
      await runYtDlp(args, url);
      return;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  throw lastError ?? new Error("yt-dlp download failed");
}

export async function isYtDlpAvailable(): Promise<boolean> {
  return (await resolveYtDlpInvocation()) !== null;
}

/**
 * Download video from the session's YouTube URL via yt-dlp.
 * Requires yt-dlp installed: https://github.com/yt-dlp/yt-dlp
 */
export async function downloadSourceFromYouTube(streamSessionId: string) {
  const session = await prisma.streamSession.findUnique({
    where: { id: streamSessionId },
    include: { sourceMedia: { take: 1 } },
  });

  if (!session) throw new Error("Session not found");

  // Skip if already downloaded (not an in-progress live buffer)
  const existing = session.sourceMedia[0];
  if (
    existing &&
    !existing.isLiveRecording &&
    (existing.durationSeconds ?? 0) > 0 &&
    fileExists(existing.filePath)
  ) {
    return existing;
  }

  const available = await isYtDlpAvailable();
  if (!available) {
    throw new Error(
      "yt-dlp is not installed. Install it from https://github.com/yt-dlp/yt-dlp and ensure it is on your PATH (or set YT_DLP_PATH in .env)."
    );
  }

  const uploadDir = getUploadDir(streamSessionId);
  await ensureDir(uploadDir);

  const outputPath = path.join(uploadDir, "source.mp4");

  await runYtDlpWithFormatFallback(
    [
      ...baseYtDlpArgs(),
      "-f",
      sourceFormatChains()[0]!,
      "-o",
      outputPath,
    ],
    session.youtubeUrl
  );

  // yt-dlp may write source.mp4 or source.f140.m4a etc. — find the output file
  let absolutePath = outputPath;
  try {
    await fs.access(absolutePath);
  } catch {
    const found = await findBestSourceFileInDir(uploadDir);
    if (!found) {
      throw new Error("Download completed but output file was not found");
    }
    absolutePath = found;
  }

  let stat;
  try {
    stat = await fs.stat(absolutePath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new Error("Download output disappeared before it could be read");
    }
    throw err;
  }
  const relativePath = toRelativeStoragePath(absolutePath);

  let probe;
  try {
    probe = await probeMedia(absolutePath);
  } catch {
    probe = {
      durationSeconds: 0,
      width: 0,
      height: 0,
      fps: 0,
      videoCodec: null,
      audioCodec: null,
      raw: {},
    };
  }

  await prisma.sourceMedia.deleteMany({ where: { streamSessionId } });

  return prisma.sourceMedia.create({
    data: {
      streamSessionId,
      originalFilename: `${session.youtubeVideoId}.mp4`,
      filePath: relativePath,
      mimeType: "video/mp4",
      sizeBytes: BigInt(stat.size),
      durationSeconds: probe.durationSeconds || null,
      width: probe.width || null,
      height: probe.height || null,
      fps: probe.fps || null,
      codecInfo: toJsonValue(probe.raw),
      isLiveRecording: false,
    },
  });
}

/** Download only the time range needed for a clip (works for YouTube, Twitch, Kick). */
export async function downloadClipSegmentFromStream(
  streamUrl: string,
  startTime: string,
  endTime: string,
  outputPath: string,
  options?: { liveFromStart?: boolean }
) {
  const available = await isYtDlpAvailable();
  if (!available) {
    throw new Error("yt-dlp is not installed. Set YT_DLP_PATH in .env.");
  }

  const section = `*${startTime}-${endTime}`;

  await runYtDlpWithFormatFallback(
    [
      ...baseYtDlpArgs(),
      ...(options?.liveFromStart ? ["--live-from-start"] : []),
      "--download-sections",
      section,
      "--force-keyframes-at-cuts",
      "-f",
      "bestvideo[height<=1080]+bestaudio/best[height<=1080]/best",
      "-o",
      outputPath,
    ],
    streamUrl,
    [
      "bestvideo[height<=1080]+bestaudio/best[height<=1080]/best",
      "bestvideo+bestaudio/best",
      "best",
    ]
  );
}

/** @deprecated Use downloadClipSegmentFromStream */
export const downloadClipSegmentFromYouTube = downloadClipSegmentFromStream;
