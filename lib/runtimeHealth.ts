import { isFfmpegAvailable, getFfmpegPath, getFfprobePath } from "@/lib/ffmpeg";
import { hasAnyAiKey } from "@/lib/aiProvider";
import { getStorageRoot, ensureDir } from "@/lib/storage";
import { isYtDlpAvailable, getLastYtDlpProbeError } from "@/services/youtubeDownloadService";
import { getYtDlpPathCandidates } from "@/lib/ytDlp";
import { isWhisperAvailable } from "@/services/whisperTranscription";
import { PRICING_PLANS } from "@/lib/pricing";
import path from "path";
import fs from "fs/promises";

export interface RuntimeHealthReport {
  ok: boolean;
  ffmpeg: boolean;
  ytDlp: boolean;
  ytDlpPotProvider: boolean | null;
  aiConfigured: boolean;
  whisperConfigured: boolean;
  storageRoot: string;
  storageWritable: boolean;
  storagePersistent: boolean;
  workerEnabled: boolean;
  ytDlpJsRuntimeCompatible: boolean;
  databaseConfigured: boolean;
  billingConfigured: boolean;
  stripeSecretConfigured: boolean;
  stripeWebhookConfigured: boolean;
  stripePricesConfigured: boolean;
  stripeMissingEnvVars: string[];
  stripeInvalidPriceEnvVars: string[];
  nodeEnv: string;
  ffmpegPath: string;
  ffprobePath: string;
  ytDlpPath: string;
  ytDlpPathCandidates: string[];
  ytDlpProbeError: string | null;
  issues: string[];
}

function hasEnv(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

function isStripePriceId(name: string): boolean {
  return /^price_/.test(process.env[name]?.trim() ?? "");
}

function getRequiredStripePriceEnvVars(): string[] {
  return PRICING_PLANS.flatMap((plan) =>
    Object.values(plan.stripePriceEnvVars ?? {})
  );
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

  const potProviderUrl = process.env.YT_DLP_POT_PROVIDER_URL?.trim();
  const [ffmpeg, ytDlp, ytDlpPotProvider] = await Promise.all([
    isFfmpegAvailable(),
    isYtDlpAvailable(),
    potProviderUrl
      ? fetch(`${potProviderUrl}/ping`, {
          signal: AbortSignal.timeout(3000),
        })
          .then((response) => response.ok)
          .catch(() => false)
      : Promise.resolve(null),
  ]);
  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  const ytDlpJsRuntimeCompatible = nodeMajor >= 22;
  const workerSetting = process.env.WORKER_ENABLED?.trim().toLowerCase();
  const workerEnabled = workerSetting
    ? !["0", "false", "off"].includes(workerSetting)
    : process.env.NODE_ENV === "production";
  const onRailway = Boolean(
    process.env.RAILWAY_PROJECT_ID || process.env.RAILWAY_ENVIRONMENT_ID
  );
  const volumeMountPath = process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim();
  const storagePersistent =
    !onRailway ||
    Boolean(
      volumeMountPath &&
        storageRoot.startsWith(path.resolve(volumeMountPath))
    );

  const stripeMissingEnvVars = [
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    ...getRequiredStripePriceEnvVars(),
  ].filter((name) => !hasEnv(name));
  const stripeInvalidPriceEnvVars = getRequiredStripePriceEnvVars().filter(
    (name) => hasEnv(name) && !isStripePriceId(name)
  );
  const databaseConfigured = hasEnv("DATABASE_URL");
  const stripeSecretConfigured = hasEnv("STRIPE_SECRET_KEY");
  const stripeWebhookConfigured = hasEnv("STRIPE_WEBHOOK_SECRET");
  const stripePricesConfigured =
    getRequiredStripePriceEnvVars().every(hasEnv) &&
    stripeInvalidPriceEnvVars.length === 0;
  const billingConfigured =
    stripeSecretConfigured && stripeWebhookConfigured && stripePricesConfigured;

  const issues: string[] = [];
  if (!databaseConfigured) {
    issues.push("Set DATABASE_URL so sessions, transcripts, usage, and render jobs can be saved.");
  }
  if (!billingConfigured) {
    const billingProblems = [
      stripeMissingEnvVars.length > 0
        ? `missing: ${stripeMissingEnvVars.join(", ")}`
        : null,
      stripeInvalidPriceEnvVars.length > 0
        ? `invalid price IDs: ${stripeInvalidPriceEnvVars.join(", ")}`
        : null,
    ]
      .filter(Boolean)
      .join("; ");
    issues.push(
      `Stripe billing is not fully configured (${billingProblems}). Without a paid billing account cookie, session creation, transcription, and rendering are blocked.`
    );
  }
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
  if (potProviderUrl && !ytDlpPotProvider) {
    issues.push(
      "The YouTube proof-of-origin token provider is not responding. Redeploy the current Docker image."
    );
  }
  if (!ytDlpJsRuntimeCompatible) {
    issues.push(
      `Node ${process.versions.node} is too old for current yt-dlp YouTube challenge solving. Deploy the Node 22 Docker image.`
    );
  }
  if (!hasAnyAiKey()) {
    issues.push("Set OPENROUTER_API_KEY or OPENAI_API_KEY for transcription.");
  }
  if (!isWhisperAvailable()) {
    issues.push("Whisper provider is not configured.");
  }
  if (!storageWritable) {
    issues.push(
      storageError
        ? `STORAGE_ROOT is not writable (${storageError}). On Railway, mount a volume at /app/storage and set STORAGE_ROOT=/app/storage.`
        : "STORAGE_ROOT is not writable. On Railway, mount a volume at /app/storage and set STORAGE_ROOT=/app/storage."
    );
  }
  if (!storagePersistent) {
    issues.push(
      "Railway storage is ephemeral. Mount a Railway volume at /app/storage or source media, transcripts, and timeline frames will disappear after redeploys."
    );
  }
  if (!workerEnabled) {
    issues.push("Background worker is disabled. Set WORKER_ENABLED=1 on Railway.");
  }

  return {
    ok: issues.length === 0,
    ffmpeg,
    ytDlp,
    ytDlpPotProvider,
    aiConfigured: hasAnyAiKey(),
    whisperConfigured: isWhisperAvailable(),
    storageRoot,
    storageWritable,
    storagePersistent,
    workerEnabled,
    ytDlpJsRuntimeCompatible,
    databaseConfigured,
    billingConfigured,
    stripeSecretConfigured,
    stripeWebhookConfigured,
    stripePricesConfigured,
    stripeMissingEnvVars,
    stripeInvalidPriceEnvVars,
    nodeEnv: process.env.NODE_ENV ?? "development",
    ffmpegPath: getFfmpegPath(),
    ffprobePath: getFfprobePath(),
    ytDlpPath: getYtDlpPathCandidates()[0] ?? "yt-dlp",
    ytDlpPathCandidates: getYtDlpPathCandidates(),
    ytDlpProbeError: ytDlp ? null : getLastYtDlpProbeError(),
    issues,
  };
}
