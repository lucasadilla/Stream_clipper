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
let cachedVisitorData: { value: string; expiresAt: number } | null = null;

const RUNTIME_COOKIES_PATH = "/tmp/youtube-cookies.txt";
const MAX_COOKIES_BYTES = 2 * 1024 * 1024;

export interface YoutubeCookieStatus {
  configured: boolean;
  valid: boolean;
  error: string | null;
}

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

export async function getYtDlpVersion(): Promise<string | null> {
  const invocation = await resolveYtDlpInvocation();
  if (!invocation) return null;
  try {
    const { stdout, stderr } = await runCommand(invocation.command, [
      ...invocation.prefixArgs,
      "--version",
    ]);
    return (stdout || stderr).trim().split(/\r?\n/, 1)[0] || null;
  } catch {
    return null;
  }
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
  const timeout = process.env.YT_DLP_SOCKET_TIMEOUT?.trim() || "30";
  const args: string[] = [
    "--retries",
    "10",
    "--fragment-retries",
    "10",
    "--socket-timeout",
    timeout,
  ];
  if (process.env.YT_DLP_FORCE_IPV4 !== "0") {
    args.push("--force-ipv4");
  }
  return args;
}

export function baseYtDlpArgs(options?: {
  youtubeExtractorArgs?: string | null;
}): string[] {
  const impersonate = process.env.YT_DLP_IMPERSONATE?.trim();
  const configuredYoutubeClient = process.env.YT_DLP_YOUTUBE_CLIENT?.trim();
  const youtubeExtractorArgs =
    options && "youtubeExtractorArgs" in options
      ? options.youtubeExtractorArgs
      : configuredYoutubeClient
        ? `player_client=${configuredYoutubeClient}`
        : null;
  const potProviderUrl = process.env.YT_DLP_POT_PROVIDER_URL?.trim();
  return [
    ...networkYtDlpArgs(),
    ...(impersonate ? ["--impersonate", impersonate] : []),
    ...(youtubeExtractorArgs
      ? ["--extractor-args", `youtube:${youtubeExtractorArgs}`]
      : []),
    ...(potProviderUrl
      ? [
          "--extractor-args",
          `youtubepot-bgutilhttp:base_url=${potProviderUrl}`,
        ]
      : []),
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

export async function getYtDlpVisitorData(): Promise<string | null> {
  if (cachedVisitorData && cachedVisitorData.expiresAt > Date.now()) {
    return cachedVisitorData.value;
  }

  const providerUrl = process.env.YT_DLP_POT_PROVIDER_URL?.trim();
  if (!providerUrl) return null;

  try {
    const response = await fetch(`${providerUrl}/get_pot`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { contentBinding?: unknown };
    if (typeof data.contentBinding !== "string" || !data.contentBinding.trim()) {
      return null;
    }
    cachedVisitorData = {
      value: data.contentBinding.trim(),
      expiresAt: Date.now() + 30 * 60 * 1000,
    };
    return cachedVisitorData.value;
  } catch {
    return null;
  }
}

function validateNetscapeCookies(contents: Buffer): void {
  if (contents.byteLength === 0 || contents.byteLength > MAX_COOKIES_BYTES) {
    throw new Error("YouTube cookies file is empty or unexpectedly large.");
  }
  const text = contents.toString("utf8");
  if (text.includes("\0")) {
    throw new Error("YouTube cookies file is not valid text.");
  }
  const lines = text.split(/\r?\n/);
  const hasNetscapeHeader = lines.some((line) =>
    /^#\s*Netscape HTTP Cookie File/i.test(line.trim())
  );
  const hasCookieRow = lines.some((line) => {
    const trimmed = line.trim();
    return Boolean(trimmed && !trimmed.startsWith("#") && line.split("\t").length >= 7);
  });
  if (!hasNetscapeHeader || !hasCookieRow) {
    throw new Error(
      "YouTube cookies must use Netscape cookies.txt format with at least one cookie."
    );
  }
}

function decodeCookiesBase64(value: string): Buffer {
  const normalized = value.replace(/\s+/g, "");
  if (!normalized || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    throw new Error("YT_DLP_COOKIES_B64 is not valid Base64.");
  }
  const decoded = Buffer.from(normalized, "base64");
  validateNetscapeCookies(decoded);
  return decoded;
}

async function resolveYoutubeCookiesPath(): Promise<string | null> {
  const configuredPath = process.env.YT_DLP_COOKIES_PATH?.trim();
  if (configuredPath) {
    validateNetscapeCookies(await fs.readFile(configuredPath));
    return configuredPath;
  }

  const cookiesBase64 = process.env.YT_DLP_COOKIES_B64?.trim();
  if (!cookiesBase64) return null;
  if (!generatedCookiesPath) {
    const contents = decodeCookiesBase64(cookiesBase64);
    await fs.writeFile(RUNTIME_COOKIES_PATH, contents, { mode: 0o600 });
    await fs.chmod(RUNTIME_COOKIES_PATH, 0o600);
    generatedCookiesPath = RUNTIME_COOKIES_PATH;
  }
  return generatedCookiesPath;
}

export async function getYoutubeCookieStatus(): Promise<YoutubeCookieStatus> {
  const configured = Boolean(
    process.env.YT_DLP_COOKIES_PATH?.trim() ||
      process.env.YT_DLP_COOKIES_B64?.trim()
  );
  if (!configured) return { configured: false, valid: false, error: null };
  try {
    await resolveYoutubeCookiesPath();
    return { configured: true, valid: true, error: null };
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : "";
    const message = /ENOENT|EACCES|EPERM|no such file|permission denied/i.test(
      rawMessage
    )
      ? "Configured YouTube cookies file could not be read."
      : rawMessage || "YouTube cookies are invalid.";
    return {
      configured: true,
      valid: false,
      error: message,
    };
  }
}

/** Optional Railway egress/auth settings for datacenter-blocked media hosts. */
export async function getYtDlpDeploymentArgs(): Promise<string[]> {
  const args: string[] = [];
  const proxy = process.env.YT_DLP_PROXY?.trim();
  if (proxy) args.push("--proxy", proxy);

  const cookiesPath = await resolveYoutubeCookiesPath();
  if (cookiesPath) args.push("--cookies", cookiesPath);

  return args;
}

export type YtDlpErrorKind =
  | "bot_verification"
  | "private_video"
  | "members_only"
  | "age_restricted"
  | "unavailable"
  | "unknown";

export function classifyYtDlpError(error: unknown): YtDlpErrorKind {
  const message = error instanceof Error ? error.message : String(error);
  if (/members[- ]only|join this channel|channel(?:'s)? members|channel members/i.test(message)) {
    return "members_only";
  }
  if (/age[- ]restricted|confirm your age|inappropriate for some users/i.test(message)) {
    return "age_restricted";
  }
  if (/private video|this video is private/i.test(message)) return "private_video";
  if (/HTTP Error 429|Too Many Requests|not a bot|LOGIN_REQUIRED|sign in to confirm/i.test(message)) {
    return "bot_verification";
  }
  if (/video unavailable|livestream.*ended|stream.*ended|has been removed|is unavailable|not available/i.test(message)) {
    return "unavailable";
  }
  return "unknown";
}

export function formatYtDlpUserError(error: unknown): string {
  switch (classifyYtDlpError(error)) {
    case "bot_verification":
      return "YouTube blocked direct capture from this server. Refresh the Railway YouTube cookies or upload the VOD instead.";
    case "private_video":
      return "This video is private. Use cookies from an account authorized to view it, or upload the VOD.";
    case "members_only":
      return "This members-only video requires cookies from an account with access, or an authorized VOD upload.";
    case "age_restricted":
      return "This age-restricted video requires authorized account cookies, or an authorized VOD upload.";
    case "unavailable":
      return "This stream has ended or is unavailable. Retry with its replay URL, or upload the VOD.";
    default:
      return error instanceof Error
        ? error.message
        : typeof error === "string" && error.trim()
          ? error.trim()
          : "Source capture failed.";
  }
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
    `bestvideo[height<=${height}]+bestaudio/best[height<=${height}]`,
    `best[height<=${height}][ext=mp4]/best[height<=${height}]`,
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
