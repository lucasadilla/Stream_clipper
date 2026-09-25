import { existsSync } from "fs";
import path from "path";
import fs from "fs/promises";
import { prisma } from "@/lib/db";
import {
  canDecodeVideoFrame,
  getFfmpegPath,
  probeMedia,
  runCommand,
} from "@/lib/ffmpeg";
import { toJsonValue } from "@/lib/utils";
import {
  parseStreamUrl,
  readStreamEmbed,
  type StreamPlatform,
} from "@/lib/streamPlatform";
import {
  getUploadDir,
  ensureDir,
  toRelativeStoragePath,
  findBestSourceFileInDir,
  fileExists,
  resolveStoragePath,
} from "@/lib/storage";
import { getYtDlpInvocationCandidates, type YtDlpInvocation } from "@/lib/ytDlp";

export { getYtDlpPath } from "@/lib/ytDlp";

let resolvedYtDlpInvocation: YtDlpInvocation | null = null;
let lastYtDlpProbeError: string | null = null;
let generatedCookiesPath: string | null = null;
let generatedTwitchCookiesPath: string | null = null;
let automaticImpersonationPromise: Promise<boolean> | null = null;

const RUNTIME_COOKIES_PATH = "/tmp/youtube-cookies.txt";
const RUNTIME_TWITCH_COOKIES_PATH = "/tmp/twitch-cookies.txt";
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

/**
 * Absolute ffmpeg binary for yt-dlp. Bare `FFMPEG_PATH=ffmpeg` must NOT use
 * process.cwd() as --ffmpeg-location (that made Twitch HLS fail with
 * "ffmpeg could not be found" while looking under /app).
 */
function resolveFfmpegBinaryForYtDlp(): string | null {
  const configured = getFfmpegPath();
  if (path.isAbsolute(configured) && existsSync(configured)) {
    return configured;
  }

  const candidates =
    process.platform === "win32"
      ? []
      : ["/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/bin/ffmpeg"];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  // Fall back to PATH lookup by omitting --ffmpeg-location.
  return null;
}

function ffmpegLocationArgs(): string[] {
  const binary = resolveFfmpegBinaryForYtDlp();
  return binary ? ["--ffmpeg-location", binary] : [];
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function detectDownloadPlatform(
  url: string
): StreamPlatform | "unknown" {
  return parseStreamUrl(url)?.platform ?? "unknown";
}

/**
 * Prefer the URL yt-dlp can actually capture from stream start.
 * - Twitch live: channel URL + --live-from-start (VOD URLs often 403 on GQL).
 * - Kick live: ongoing VOD UUID URL (kick:vod). Channel URLs are live-edge only;
 *   Kick does not support --live-from-start on kick:live.
 */
export function resolveStreamCaptureUrl(session: {
  platform?: string | null;
  youtubeUrl: string;
  liveStatus?: string | null;
  metadataJson?: unknown;
}): string {
  const platform = session.platform ?? "youtube";
  const isLive =
    session.liveStatus === "live" || session.liveStatus === "upcoming";
  const embed = readStreamEmbed(session.metadataJson);
  const parsed = parseStreamUrl(session.youtubeUrl);

  if (platform === "kick" && isLive) {
    const channel =
      embed?.kickChannel?.trim() || parsed?.embed.kickChannel?.trim();
    const videoId =
      embed?.kickVideoId?.trim() || parsed?.embed.kickVideoId?.trim();
    if (channel && videoId) {
      return `https://kick.com/${channel}/videos/${videoId}`;
    }
    if (channel) {
      return `https://kick.com/${channel}`;
    }
    return session.youtubeUrl;
  }

  if (platform !== "twitch") {
    return session.youtubeUrl;
  }
  if (!isLive) return session.youtubeUrl;

  const channel = embed?.twitchChannel?.trim();
  if (channel) {
    return `https://www.twitch.tv/${channel}`;
  }

  if (parsed?.embed.twitchChannel) {
    return `https://www.twitch.tv/${parsed.embed.twitchChannel}`;
  }
  return session.youtubeUrl;
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

export interface YoutubeCaptureStrategy {
  id:
    | "configured"
    | "default"
    | "provider"
    | "live-hls"
    | "tv"
    | "public-default"
    | "public-no-cookie";
  extractorArgs: string | null;
  includeCookies: boolean;
}

/**
 * Ordered YouTube clients. Prefer cookie-backed clients first; fall back to
 * public android/tv clients that often work when cookies are rotated/invalid.
 */
export function getYoutubeCaptureStrategies(): YoutubeCaptureStrategy[] {
  const configuredClient = process.env.YT_DLP_YOUTUBE_CLIENT?.trim();
  const candidates: YoutubeCaptureStrategy[] = [
    {
      id: "configured",
      extractorArgs: configuredClient
        ? `player_client=${configuredClient}`
        : null,
      includeCookies: true,
    },
    // Explicitly remove a configured client override as the next strategy.
    // Current yt-dlp defaults can expose seekable high-resolution HLS formats
    // (for example visionOS) that mweb-only configurations do not return.
    {
      id: "default",
      extractorArgs: null,
      includeCookies: true,
    },
    {
      id: "provider",
      extractorArgs: "player_client=default,mweb",
      includeCookies: true,
    },
    {
      id: "live-hls",
      extractorArgs: "player_client=web_safari",
      includeCookies: true,
    },
    {
      id: "tv",
      extractorArgs: "player_client=tv",
      includeCookies: true,
    },
    // Cookie-backed clients can hide HD formats on otherwise public videos.
    // Retry the normal client set without cookies before the Android fallback.
    {
      id: "public-default",
      extractorArgs: null,
      includeCookies: false,
    },
    // Invalid/rotated cookies commonly poison web clients with CDN 403s.
    // Plain android (no cookies) works; android_vr alone often 403s without a PO token.
    {
      id: "public-no-cookie",
      extractorArgs: "player_client=android",
      includeCookies: false,
    },
  ];

  const seen = new Set<string>();
  return candidates.filter((strategy) => {
    const key = `${strategy.extractorArgs ?? "default"}:${strategy.includeCookies}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function isYoutubePoTokenError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /PO Token|GVS PO Token|No video formats found/i.test(message);
}

/** CDN/format blocks that often clear when switching player clients. */
export function isYoutubeStreamForbiddenError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /unable to download video data.*403|HTTP Error 403:\s*Forbidden/i.test(
    message
  );
}

export function baseYtDlpArgs(options?: {
  /** When set, YouTube-only / Twitch-only extractor args are scoped correctly. */
  platform?: StreamPlatform | "unknown";
  /** Optional media URL — used to infer platform when `platform` is omitted. */
  url?: string;
  youtubeExtractorArgs?: string | null;
}): string[] {
  const platform =
    options?.platform ??
    (options?.url ? detectDownloadPlatform(options.url) : "unknown");
  const impersonate = process.env.YT_DLP_IMPERSONATE?.trim();
  const configuredYoutubeClient = process.env.YT_DLP_YOUTUBE_CLIENT?.trim();
  const youtubeExtractorArgs =
    options && "youtubeExtractorArgs" in options
      ? options.youtubeExtractorArgs
      : configuredYoutubeClient
        ? `player_client=${configuredYoutubeClient}`
        : null;
  const potProviderUrl = process.env.YT_DLP_POT_PROVIDER_URL?.trim();
  // GQL web/console client id only — NOT the Helix Developer Console app id.
  // Passing TWITCH_CLIENT_ID (Helix) here makes gql.twitch.tv return HTTP 400.
  const twitchGqlClientId = process.env.YT_DLP_TWITCH_CLIENT_ID?.trim();

  const args: string[] = [
    ...networkYtDlpArgs(),
    ...(impersonate ? ["--impersonate", impersonate] : []),
    ...ffmpegLocationArgs(),
    // Expose growing media files immediately so transcription and timeline
    // thumbnails do not wait for a multi-hour VOD download to finish.
    "--no-part",
    "--js-runtimes",
    getYtDlpJsRuntimeArg(),
    "--no-playlist",
  ];

  // YouTube-only args — never attach to Twitch/Kick (keeps those extractors clean).
  if (platform === "youtube" || platform === "unknown") {
    if (youtubeExtractorArgs) {
      args.push("--extractor-args", `youtube:${youtubeExtractorArgs}`);
    }
    if (potProviderUrl) {
      args.push(
        "--extractor-args",
        `youtubepot-bgutilhttp:base_url=${potProviderUrl}`
      );
    }
  }

  if (platform === "twitch" && twitchGqlClientId) {
    args.push("--extractor-args", `twitch:client_id=${twitchGqlClientId}`);
  }

  return args;
}

function validateNetscapeCookies(
  contents: Buffer,
  label = "Cookies"
): void {
  if (contents.byteLength === 0 || contents.byteLength > MAX_COOKIES_BYTES) {
    throw new Error(`${label} file is empty or unexpectedly large.`);
  }
  const text = contents.toString("utf8");
  if (text.includes("\0")) {
    throw new Error(`${label} file is not valid text.`);
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
      `${label} must use Netscape cookies.txt format with at least one cookie.`
    );
  }
}

function decodeCookiesBase64(value: string, label: string): Buffer {
  const normalized = value.replace(/\s+/g, "");
  if (!normalized || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    throw new Error(`${label} is not valid Base64.`);
  }
  const decoded = Buffer.from(normalized, "base64");
  validateNetscapeCookies(decoded, label);
  return decoded;
}

async function resolveYoutubeCookiesPath(): Promise<string | null> {
  const configuredPath = process.env.YT_DLP_COOKIES_PATH?.trim();
  if (configuredPath) {
    // Always copy to a runtime path. yt-dlp rewrites --cookies files in place
    // and can strip LOGIN_INFO / SID, which immediately breaks later downloads.
    if (!generatedCookiesPath) {
      const contents = await fs.readFile(configuredPath);
      validateNetscapeCookies(contents, "YouTube cookies");
      await fs.writeFile(RUNTIME_COOKIES_PATH, contents, { mode: 0o600 });
      await fs.chmod(RUNTIME_COOKIES_PATH, 0o600);
      generatedCookiesPath = RUNTIME_COOKIES_PATH;
    }
    return generatedCookiesPath;
  }

  const cookiesBase64 = process.env.YT_DLP_COOKIES_B64?.trim();
  if (!cookiesBase64) return null;
  if (!generatedCookiesPath) {
    const contents = decodeCookiesBase64(cookiesBase64, "YT_DLP_COOKIES_B64");
    await fs.writeFile(RUNTIME_COOKIES_PATH, contents, { mode: 0o600 });
    await fs.chmod(RUNTIME_COOKIES_PATH, 0o600);
    generatedCookiesPath = RUNTIME_COOKIES_PATH;
  }
  return generatedCookiesPath;
}

async function resolveTwitchCookiesPath(): Promise<string | null> {
  const configuredPath = process.env.TWITCH_COOKIES_PATH?.trim();
  if (configuredPath) {
    if (!generatedTwitchCookiesPath) {
      const contents = await fs.readFile(configuredPath);
      validateNetscapeCookies(contents, "Twitch cookies");
      await fs.writeFile(RUNTIME_TWITCH_COOKIES_PATH, contents, { mode: 0o600 });
      await fs.chmod(RUNTIME_TWITCH_COOKIES_PATH, 0o600);
      generatedTwitchCookiesPath = RUNTIME_TWITCH_COOKIES_PATH;
    }
    return generatedTwitchCookiesPath;
  }

  const cookiesBase64 = process.env.TWITCH_COOKIES_B64?.trim();
  if (!cookiesBase64) return null;
  if (!generatedTwitchCookiesPath) {
    const contents = decodeCookiesBase64(cookiesBase64, "TWITCH_COOKIES_B64");
    await fs.writeFile(RUNTIME_TWITCH_COOKIES_PATH, contents, { mode: 0o600 });
    await fs.chmod(RUNTIME_TWITCH_COOKIES_PATH, 0o600);
    generatedTwitchCookiesPath = RUNTIME_TWITCH_COOKIES_PATH;
  }
  return generatedTwitchCookiesPath;
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

/** Optional Railway egress/auth settings. Cookies are platform-scoped. */
export async function getYtDlpDeploymentArgs(
  platform: StreamPlatform | "unknown" = "unknown",
  options?: { includeCookies?: boolean }
): Promise<string[]> {
  const args: string[] = [];
  const proxy = process.env.YT_DLP_PROXY?.trim();
  if (proxy) args.push("--proxy", proxy);

  if (
    !process.env.YT_DLP_IMPERSONATE?.trim() &&
    (await supportsAutomaticChromeImpersonation())
  ) {
    args.push("--impersonate", "chrome");
  }

  if (platform === "twitch" && options?.includeCookies !== false) {
    const twitchCookies = await resolveTwitchCookiesPath();
    if (twitchCookies) args.push("--cookies", twitchCookies);
    return args;
  }

  // YouTube (and unknown callers) keep the existing YouTube cookie path.
  if (
    options?.includeCookies !== false &&
    (platform === "youtube" || platform === "unknown")
  ) {
    const cookiesPath = await resolveYoutubeCookiesPath();
    if (cookiesPath) args.push("--cookies", cookiesPath);
  }

  return args;
}

async function supportsAutomaticChromeImpersonation(): Promise<boolean> {
  if (!automaticImpersonationPromise) {
    automaticImpersonationPromise = (async () => {
      const invocation = await resolveYtDlpInvocation();
      if (!invocation) return false;
      try {
        const { stdout, stderr } = await runCommand(invocation.command, [
          ...invocation.prefixArgs,
          "--list-impersonate-targets",
        ]);
        return /^Chrome(?:-\S+)?\s+.*curl_cffi\s*$/im.test(
          `${stdout}\n${stderr}`
        );
      } catch {
        return false;
      }
    })();
  }
  return automaticImpersonationPromise;
}

export function isLiveFromStartUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /no formats that can be downloaded from the start|Unable to extract the VOD associated|--live-from-start is passed/i.test(
    message
  );
}

export function isFatalTwitchCaptureError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    isLiveFromStartUnavailable(message) ||
    (/twitch/i.test(message) &&
      /HTTP Error 40[03]|Forbidden|Bad Request|Unable to download JSON metadata|gql\.twitch\.tv/i.test(
        message
      ))
  );
}

export type YtDlpErrorKind =
  | "po_token_unavailable"
  | "bot_verification"
  | "private_video"
  | "members_only"
  | "age_restricted"
  | "unavailable"
  | "twitch_forbidden"
  | "twitch_live_from_start"
  | "ffmpeg_missing"
  | "youtube_forbidden"
  | "unknown";

export function classifyYtDlpError(error: unknown): YtDlpErrorKind {
  const message = error instanceof Error ? error.message : String(error);
  if (/ffmpeg could not be found|ffmpeg is not installed/i.test(message)) {
    return "ffmpeg_missing";
  }
  if (isLiveFromStartUnavailable(message)) {
    return "twitch_live_from_start";
  }
  if (isYoutubePoTokenError(message)) {
    return "po_token_unavailable";
  }
  if (
    /twitch|gql\.twitch\.tv/i.test(message) &&
    /HTTP Error 40[03]|Forbidden|Bad Request|Unable to download JSON metadata|cookies?/i.test(
      message
    )
  ) {
    return "twitch_forbidden";
  }
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
  if (isYoutubeStreamForbiddenError(message)) {
    return "youtube_forbidden";
  }
  return "unknown";
}

export function formatYtDlpUserError(error: unknown): string {
  switch (classifyYtDlpError(error)) {
    case "po_token_unavailable":
      return "YouTube did not return a playable format to this server. Clipper tried its token provider and fallback clients; retry shortly or upload the authorized VOD.";
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
    case "twitch_live_from_start":
      return (
        "Twitch has no start-of-stream VOD for this broadcast, so capture continues from the live edge. " +
        "Past moments before capture started won't be available unless you upload the VOD later."
      );
    case "twitch_forbidden":
      return (
        "Twitch blocked stream metadata from this server. Keep TWITCH_CLIENT_ID for Helix only " +
        "(do not use it as a yt-dlp client id). Add TWITCH_COOKIES_B64 from a logged-in browser, " +
        "or set YT_DLP_PROXY. For live streams, paste the channel URL (twitch.tv/name)."
      );
    case "ffmpeg_missing":
      return (
        "FFmpeg was not found for Twitch HLS remux. Redeploy the latest image, " +
        "or set FFMPEG_PATH to the absolute ffmpeg binary path."
      );
    case "youtube_forbidden":
      return (
        "YouTube refused the media download (HTTP 403). Clipper tried its browser, " +
        "token, and public-client fallbacks. Refresh the server's YouTube cookies " +
        "and confirm the PO-token provider is healthy, or upload an authorized VOD."
      );
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
  options?: {
    retries?: number;
    platform?: StreamPlatform | "unknown";
    includeCookies?: boolean;
    timeoutMs?: number;
    onOutputLine?: (line: string) => void;
  }
): Promise<{ stdout: string; stderr: string }> {
  const invocation = await resolveYtDlpInvocation();
  if (!invocation) {
    throw new Error(
      lastYtDlpProbeError ??
        "yt-dlp is not installed. Redeploy with the latest Dockerfile or set YT_DLP_PATH."
    );
  }

  const platform = options?.platform ?? detectDownloadPlatform(url);
  const retries = Math.max(1, options?.retries ?? 3);
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const deploymentArgs = await getYtDlpDeploymentArgs(platform, {
        includeCookies: options?.includeCookies,
      });
      return await runCommand(
        invocation.command,
        [
          ...invocation.prefixArgs,
          ...deploymentArgs,
          ...extraArgs,
          url,
        ],
        {
          timeoutMs: options?.timeoutMs,
          onOutputLine: options?.onOutputLine,
        }
      );
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

function sourceMaxHeight(options?: { agent?: boolean }): number {
  const configured = Number.parseInt(
    process.env.SOURCE_MAX_HEIGHT?.trim() ?? "",
    10
  );
  if (Number.isFinite(configured) && configured >= 240) return configured;
  // Agent prep needs transcript ASAP; HD is reserved for final render fetches.
  if (options?.agent) return 480;
  // Railway only needs a lightweight analysis/editing copy. Final render
  // segments can still be fetched separately at higher quality.
  return process.env.NODE_ENV === "production" ? 480 : 1080;
}

function sourceFormatChains(height = sourceMaxHeight()): string[] {
  const audio = preferredBestAudio();
  const aacAudio = preferredBestAudio("[acodec^=mp4a]");
  // Avoid bare "best" / pre-merged progressive formats — YouTube CDN often
  // returns HTTP 403 for those. Prefer separate video+audio (merged by ffmpeg).
  // Prefer original-language audio so AI dubs never replace the spoken track.
  return [
    `bestvideo[vcodec^=avc1][height<=${height}]+${aacAudio}/bestvideo[height<=${height}]+${audio}`,
    `bestvideo[vcodec^=avc1][height<=${height}]+${audio}/bestvideo[height<=${height}]+${audio}`,
    `bestvideo[height<=${height}]+${audio}`,
    `bestvideo*+${audio}/b`,
    "b",
  ];
}

/**
 * Prefer the stream's original spoken audio over YouTube AI dubs.
 * Optional PREFERRED_AUDIO_LANGUAGE (ISO-639-1) pins a specific dub/track.
 */
export function preferredBestAudio(extraFilters = ""): string {
  const preferredLang = process.env.PREFERRED_AUDIO_LANGUAGE?.trim().toLowerCase();
  if (preferredLang && /^[a-z]{2,3}(-[a-z0-9]+)?$/i.test(preferredLang)) {
    return (
      `(bestaudio[language^=${preferredLang}]${extraFilters}/` +
      `bestaudio[format_note*=original]${extraFilters}/` +
      `bestaudio${extraFilters})`
    );
  }
  // Keep the fallback grouped whenever callers combine it with bestvideo.
  // Without parentheses, `bestvideo+originalAudio/bestAudio` can resolve to
  // audio-only when YouTube does not label a track as "original".
  return `(bestaudio[format_note*=original]${extraFilters}/bestaudio${extraFilters})`;
}

/** Format-sort fields for final downloads — lang first so dubs lose to original. */
export function renderSourceFormatSort(): string {
  return "lang,res,fps,br,codec:vp9:av01:avc1";
}

async function runYtDlpWithFormatFallback(
  baseArgs: string[],
  url: string,
  formats = sourceFormatChains(),
  options?: {
    timeoutMs?: number;
    attemptTimeoutMs?: number;
    maxAttempts?: number;
    retriesPerFormat?: number;
    preferDefaultClient?: boolean;
    minVideoHeight?: number;
    onProgress?: (progress: number) => void;
    onAttempt?: (attempt: number) => void;
  }
): Promise<void> {
  let lastError: Error | null = null;
  const deadline = options?.timeoutMs
    ? Date.now() + Math.max(1_000, options.timeoutMs)
    : null;
  const platform = detectDownloadPlatform(url);
  const availableStrategies =
    platform === "youtube"
      ? getYoutubeCaptureStrategies()
      : [{ id: "configured", extractorArgs: null, includeCookies: true } as const];
  const strategies =
    platform === "youtube" && options?.preferDefaultClient
      ? [
          ...availableStrategies.filter((strategy) => strategy.id === "public-default"),
          ...availableStrategies.filter(
            (strategy) => strategy.extractorArgs === null && strategy.id !== "public-default"
          ),
          ...availableStrategies.filter(
            (strategy) => strategy.extractorArgs !== null
          ),
        ]
      : availableStrategies;
  let totalAttempts = 0;

  for (const strategy of strategies) {
    let strategyAttempts = 0;
    for (const format of formats) {
      if (
        options?.maxAttempts &&
        strategyAttempts >= options.maxAttempts
      ) {
        break;
      }
      const remainingMs = deadline ? deadline - Date.now() : undefined;
      if (remainingMs !== undefined && remainingMs <= 0) {
        throw new Error("yt-dlp source download timed out");
      }
      strategyAttempts += 1;
      totalAttempts += 1;
      options?.onAttempt?.(totalAttempts);
      const args = withYoutubeExtractorArgs(
        baseArgs,
        platform === "youtube" ? strategy.extractorArgs : undefined
      );
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

      const outputIndex = args.indexOf("-o");
      const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : undefined;
      if (outputPath) await fs.unlink(outputPath).catch(() => {});

      const attemptTimeoutMs = options?.attemptTimeoutMs
        ? Math.min(
            options.attemptTimeoutMs,
            remainingMs ?? options.attemptTimeoutMs
          )
        : remainingMs;

      try {
        await runYtDlp(args, url, {
          platform,
          includeCookies: strategy.includeCookies,
          retries: options?.retriesPerFormat,
          timeoutMs: attemptTimeoutMs,
          onOutputLine: (line) => {
            const progress = parseYtDlpProgress(line);
            if (progress != null) options?.onProgress?.(progress);
          },
        });
        if (outputPath && !(await canDecodeVideoFrame(outputPath))) {
          await fs.unlink(outputPath).catch(() => {});
          throw new Error(
            `yt-dlp produced video that FFmpeg could not decode for format ${format}`
          );
        }
        if (outputPath && options?.minVideoHeight) {
          const probe = await probeMedia(outputPath);
          if ((probe.height ?? 0) < options.minVideoHeight) {
            await fs.unlink(outputPath).catch(() => {});
            throw new Error(
              `yt-dlp returned ${probe.width}x${probe.height} for format ${format}; need at least ${options.minVideoHeight}p`
            );
          }
        }
        return;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        // Format swaps cannot repair a missing PO token / empty format list.
        // CDN 403s are often format-specific (e.g. progressive "best"), so keep
        // trying other formats before moving to the next player client.
        if (platform === "youtube" && isYoutubePoTokenError(lastError)) break;
      }
    }
  }

  throw lastError ?? new Error("yt-dlp download failed");
}

export function renderSourceMaxHeight(): number {
  const configured = Number.parseInt(
    process.env.RENDER_SOURCE_MAX_HEIGHT?.trim() ?? "",
    10
  );
  return Number.isFinite(configured) && configured >= 720
    ? configured
    : 2160;
}

/** Hard floor for final exports — never treat a 360p proxy as master quality. */
export function minFinalSourceHeight(): number {
  const configured = Number.parseInt(
    process.env.RENDER_SOURCE_MIN_HEIGHT?.trim() ?? "",
    10
  );
  return Number.isFinite(configured) && configured >= 360
    ? configured
    : 720;
}

/**
 * Height that is "good enough" to reuse without forcing another download.
 * Most VODs top out at 1080p60; insisting on 2160 would redownload forever.
 */
export function acceptableFinalSourceHeight(): number {
  return Math.min(1080, renderSourceMaxHeight());
}

/** Parse Clipper's yt-dlp progress template into a stable zero-to-one value. */
export function parseYtDlpProgress(line: string): number | null {
  const match = /clipper-progress:\s*([0-9]+(?:\.[0-9]+)?)%/i.exec(line);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value / 100)) : null;
}

export function renderSourceFormatChains(
  renderHeight = renderSourceMaxHeight()
): string[] {
  // Short-range exports need seekable HLS first. YouTube's DASH URLs may make
  // FFmpeg read most of a long VOD before reaching --download-sections, while
  // HLS seeks directly to the requested fragments. This preserves the same
  // maximum resolution and frame rate while avoiding multi-minute stalls.
  // HLS VP9 is named "vp09", so vcodec^=vp9 selectors miss it.
  // Always prefer original audio — bare bestaudio can pick a YouTube AI dub
  // while the studio preview still uses the live/original track.
  const audio = preferredBestAudio();
  const hlsAudio = preferredBestAudio("[protocol^=m3u8]");
  return [
    `bestvideo[protocol^=m3u8][height<=${renderHeight}][fps>50]+${hlsAudio}/bestvideo[protocol^=m3u8][height<=${renderHeight}]+${hlsAudio}`,
    `bestvideo[protocol^=m3u8][height<=${renderHeight}]+${hlsAudio}`,
    `bestvideo[protocol^=m3u8][height<=${renderHeight}]+${audio}`,
    `bestvideo[height<=${renderHeight}][fps>50]+${audio}/bestvideo[height<=${renderHeight}]+${audio}`,
    `bestvideo[height<=${renderHeight}]+${audio}`,
    `best[height<=${renderHeight}]`,
  ];
}

function withYoutubeExtractorArgs(
  args: string[],
  youtubeExtractorArgs: string | null | undefined
): string[] {
  if (youtubeExtractorArgs === undefined) return [...args];

  const next: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (
      args[index] === "--extractor-args" &&
      args[index + 1]?.startsWith("youtube:")
    ) {
      index += 1;
      continue;
    }
    next.push(args[index]!);
  }
  if (youtubeExtractorArgs) {
    next.push("--extractor-args", `youtube:${youtubeExtractorArgs}`);
  }
  return next;
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
    include: {
      sourceMedia: {
        where: {
          isLiveRecording: false,
          NOT: [
            { originalFilename: { startsWith: "segment-" } },
            { originalFilename: { startsWith: "render-source-" } },
            { originalFilename: "preview.mp4" },
          ],
        },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
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
    const existingPath = resolveStoragePath(existing.filePath);
    if (await canDecodeVideoFrame(existingPath)) return existing;

    // A valid MP4 header is not enough: broken AV1/DASH packets can still make
    // every thumbnail, face job and render fail. Remove only the unusable copy.
    await fs.unlink(existingPath).catch(() => {});
    await prisma.sourceMedia.delete({ where: { id: existing.id } }).catch(() => {});
  }

  const available = await isYtDlpAvailable();
  if (!available) {
    throw new Error(
      "yt-dlp is not installed. Install it from https://github.com/yt-dlp/yt-dlp and ensure it is on your PATH (or set YT_DLP_PATH in .env)."
    );
  }

  const uploadDir = getUploadDir(streamSessionId);
  const { reclaimEphemeralStorage } = await import(
    "@/services/storageReclaimService"
  );
  await reclaimEphemeralStorage({
    keepSessionId: streamSessionId,
    pruneSessionSegments: true,
  });
  await ensureDir(uploadDir);

  const outputPath = path.join(uploadDir, "source.mp4");
  const captureUrl = resolveStreamCaptureUrl(session);
  const platform = detectDownloadPlatform(captureUrl);
  const agentPrep = session.mode === "agent";
  const formatHeight = sourceMaxHeight({ agent: agentPrep });
  const formatFallbacks = sourceFormatChains(formatHeight);
  // Unbounded VOD downloads left Agent Mode on "Preparing your video" for 15–20+ minutes.
  const downloadTimeoutMs = Number.parseInt(
    process.env.SOURCE_DOWNLOAD_TIMEOUT_MS?.trim() ?? "",
    10
  );
  const timeoutMs =
    Number.isFinite(downloadTimeoutMs) && downloadTimeoutMs >= 60_000
      ? downloadTimeoutMs
      : agentPrep
        ? 8 * 60_000
        : 12 * 60_000;

  await runYtDlpWithFormatFallback(
    [
      ...baseYtDlpArgs({ platform, url: captureUrl }),
      "-f",
      formatFallbacks[0]!,
      "-o",
      outputPath,
    ],
    captureUrl,
    formatFallbacks,
    {
      timeoutMs,
      attemptTimeoutMs: Math.min(3 * 60_000, timeoutMs),
      maxAttempts: 6,
      retriesPerFormat: 1,
      preferDefaultClient: agentPrep,
    }
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
  options?: {
    liveFromStart?: boolean;
    timeoutMs?: number;
    attemptTimeoutMs?: number;
    minVideoHeight?: number;
    onProgress?: (progress: number) => void;
    onAttempt?: (attempt: number) => void;
  }
) {
  const available = await isYtDlpAvailable();
  if (!available) {
    throw new Error("yt-dlp is not installed. Set YT_DLP_PATH in .env.");
  }

  const section = `*${startTime}-${endTime}`;
  const platform = detectDownloadPlatform(streamUrl);
  // Analysis copies stay deliberately small, but a final render downloads only
  // its selected range and should use every pixel the source can provide.
  const formatFallbacks = renderSourceFormatChains();
  const minVideoHeight = options?.minVideoHeight ?? minFinalSourceHeight();

  const deadline = options?.timeoutMs
    ? Date.now() + Math.max(1_000, options.timeoutMs)
    : null;
  const attempt = async (liveFromStart: boolean) => {
    const remainingMs = deadline ? deadline - Date.now() : undefined;
    if (remainingMs !== undefined && remainingMs <= 0) {
      throw new Error("yt-dlp source download timed out");
    }
    await runYtDlpWithFormatFallback(
      [
        ...baseYtDlpArgs({ platform, url: streamUrl }),
        ...(liveFromStart ? ["--live-from-start"] : ["--no-live-from-start"]),
        "--download-sections",
        section,
        "--newline",
        "--progress-template",
        "download:clipper-progress:%(progress._percent_str)s",
        "--format-sort-force",
        "-S",
        renderSourceFormatSort(),
        "-f",
        formatFallbacks[0]!,
        "-o",
        outputPath,
      ],
      streamUrl,
      formatFallbacks,
      {
        timeoutMs: remainingMs,
        attemptTimeoutMs: options?.attemptTimeoutMs,
        // Allow enough format×client attempts to escape a 360p-only client.
        maxAttempts: options?.timeoutMs ? 8 : undefined,
        retriesPerFormat: options?.timeoutMs ? 1 : undefined,
        preferDefaultClient: true,
        minVideoHeight,
        onProgress: options?.onProgress,
        onAttempt: options?.onAttempt,
      }
    );
  };

  try {
    await attempt(Boolean(options?.liveFromStart));
  } catch (error) {
    if (options?.liveFromStart && isLiveFromStartUnavailable(error)) {
      await attempt(false);
      return;
    }
    throw error;
  }
}

/** @deprecated Use downloadClipSegmentFromStream */
export const downloadClipSegmentFromYouTube = downloadClipSegmentFromStream;
