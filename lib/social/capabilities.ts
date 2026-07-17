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

function metaDefault(): SocialCapabilityStatus {
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
          ? metaDefault()
          : platform === "tiktok"
            ? tiktokDefault()
            : "not_configured";
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
    status === "private_test_only" ||
    status === "development_only" ||
    status === "awaiting_review"
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
    return "YouTube uploads may be restricted to private until the Google API project completes verification.";
  }
  if (
    platform === "tiktok" &&
    (status === "private_test_only" ||
      status === "development_only" ||
      status === "awaiting_review")
  ) {
    return "Unaudited TikTok apps can only publish as private (SELF_ONLY). Request video.publish / video.upload and pass TikTok’s audit for public posts.";
  }
  if (platform === "x" && (status === "development_only" || status === "awaiting_review")) {
    return "X publishing requires API access with media.write and tweet.write. Configure X_CLIENT_ID / X_CLIENT_SECRET.";
  }
  if (
    (platform === "instagram" || platform === "facebook") &&
    (status === "development_only" || status === "awaiting_review")
  ) {
    return "Meta apps need App Review for public publishing. Use a Facebook Page and a linked Instagram professional account.";
  }
  if (platform === "instagram" && status !== "not_configured") {
    return "Instagram requires a professional account linked to a Facebook Page.";
  }
  if (platform === "facebook" && status !== "not_configured") {
    return "Facebook publishing targets Pages you manage, not personal profiles.";
  }
  if (status === "not_configured") {
    return `${platform} publishing is not configured yet.`;
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
