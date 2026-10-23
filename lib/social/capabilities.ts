import type {
  SocialCapabilityStatus,
  SocialPlatform,
} from "@/lib/social/types";
import { SOCIAL_PLATFORMS } from "@/lib/social/types";

const ENV_KEYS: Record<SocialPlatform, string> = {
  youtube: "YOUTUBE_PUBLISH_CAPABILITY",
  tiktok: "TIKTOK_PUBLISH_CAPABILITY",
  instagram: "INSTAGRAM_PUBLISH_CAPABILITY",
  facebook: "FACEBOOK_PUBLISH_CAPABILITY",
  x: "X_PUBLISH_CAPABILITY",
  reddit: "REDDIT_PUBLISH_CAPABILITY",
};

const VALID: SocialCapabilityStatus[] = [
  "not_configured",
  "development_only",
  "awaiting_review",
  "private_test_only",
  "production_ready",
  "temporarily_disabled",
];

function parseStatus(raw: string | undefined, fallback: SocialCapabilityStatus) {
  const value = raw?.trim().toLowerCase() as SocialCapabilityStatus | undefined;
  if (value && VALID.includes(value)) return value;
  return fallback;
}

function youtubeDefault(): SocialCapabilityStatus {
  if (
    process.env.YOUTUBE_CLIENT_ID?.trim() &&
    process.env.YOUTUBE_CLIENT_SECRET?.trim()
  ) {
    return "private_test_only";
  }
  return "not_configured";
}

function xDefault(): SocialCapabilityStatus {
  if (process.env.X_CLIENT_ID?.trim() && process.env.X_CLIENT_SECRET?.trim()) {
    return "development_only";
  }
  return "not_configured";
}

function metaDefault(platform: SocialPlatform): SocialCapabilityStatus {
  if (platform === "instagram" && process.env.INSTAGRAM_CLIENT_ID?.trim() && process.env.INSTAGRAM_CLIENT_SECRET?.trim()) return "development_only";
  if (process.env.META_APP_ID?.trim() && process.env.META_APP_SECRET?.trim()) {
    return "development_only";
  }
  return "not_configured";
}

function tiktokDefault(): SocialCapabilityStatus {
  if (
    process.env.TIKTOK_CLIENT_KEY?.trim() &&
    process.env.TIKTOK_CLIENT_SECRET?.trim()
  ) {
    return "private_test_only";
  }
  return "not_configured";
}

export function getPlatformCapability(
  platform: SocialPlatform
): SocialCapabilityStatus {
  const fallback =
    platform === "youtube"
      ? youtubeDefault()
      : platform === "x"
        ? xDefault()
        : platform === "instagram" || platform === "facebook"
          ? metaDefault(platform)
          : platform === "tiktok"
            ? tiktokDefault()
            : "not_configured";
  // A deployment flag cannot substitute for an OAuth application.
  if (fallback === "not_configured") return fallback;
  return parseStatus(process.env[ENV_KEYS[platform]], fallback);
}

export function canConnectPlatform(platform: SocialPlatform): boolean {
  const status = getPlatformCapability(platform);
  return (
    status !== "not_configured" &&
    status !== "temporarily_disabled"
  );
}

export function canPublishPlatform(platform: SocialPlatform): boolean {
  const status = getPlatformCapability(platform);
  return (
    status === "production_ready" ||
    status === "private_test_only" ||
    status === "development_only" ||
    status === "awaiting_review"
  );
}

export function forcesPrivateUploads(platform: SocialPlatform): boolean {
  const status = getPlatformCapability(platform);
  return (
    (platform === "youtube" || platform === "tiktok") &&
    (
    status === "private_test_only" ||
    status === "development_only" ||
    status === "awaiting_review"
    )
  );
}

export function capabilityLabel(status: SocialCapabilityStatus): string {
  switch (status) {
    case "not_configured":
      return "Not configured";
    case "development_only":
      return "Development only";
    case "awaiting_review":
      return "Awaiting platform review";
    case "private_test_only":
      return "Private test posts only";
    case "production_ready":
      return "Ready";
    case "temporarily_disabled":
      return "Temporarily disabled";
  }
}

export function capabilityBanner(platform: SocialPlatform): string | null {
  const status = getPlatformCapability(platform);
  if (platform === "youtube" && status === "private_test_only") {
    return "YouTube uploads stay private until this app completes YouTube's API compliance audit.";
  }
  if (
    platform === "tiktok" &&
    (status === "private_test_only" ||
      status === "development_only" ||
      status === "awaiting_review")
  ) {
    return "TikTok requires review of each post. Posts stay private until TikTok approves this app for public publishing.";
  }
  if (platform === "x" && (status === "development_only" || status === "awaiting_review")) {
    return "Posting requires an X developer account with publishing access and available API credits. Posts follow your X account's visibility.";
  }
  if (
    (platform === "instagram" || platform === "facebook") &&
    (status === "development_only" || status === "awaiting_review")
  ) {
    return platform === "instagram"
      ? "Instagram requires a Business or Creator account. Connecting accounts outside this app’s testers requires Meta approval."
      : "Facebook publishing targets Pages you manage. Connecting other businesses requires Meta approval.";
  }
  if (platform === "instagram" && status !== "not_configured") {
    return process.env.INSTAGRAM_CLIENT_ID?.trim() && process.env.INSTAGRAM_CLIENT_SECRET?.trim()
      ? "Instagram requires a Business or Creator account; a Facebook Page is not needed."
      : "Instagram requires a professional account linked to a Facebook Page.";
  }
  if (platform === "facebook" && status !== "not_configured") {
    return "Facebook publishing targets Pages you manage, not personal profiles.";
  }
  if (status === "temporarily_disabled") {
    return `${platform} publishing is temporarily disabled.`;
  }
  return null;
}

export function allPlatformCapabilities(): Record<
  SocialPlatform,
  SocialCapabilityStatus
> {
  return Object.fromEntries(
    SOCIAL_PLATFORMS.map((platform) => [platform, getPlatformCapability(platform)])
  ) as Record<SocialPlatform, SocialCapabilityStatus>;
}
