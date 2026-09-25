import type { PlatformKey } from "@/lib/platforms/types";

const PLATFORM_FILENAME_LABELS: Record<PlatformKey, string> = {
  youtube_shorts: "YouTube Shorts",
  youtube_landscape: "YouTube",
  tiktok: "TikTok",
  instagram_reels: "Instagram Reels",
  instagram_feed: "Instagram Feed",
  facebook_reels: "Facebook Reels",
  facebook_feed: "Facebook Feed",
  x: "X",
};

/** Create a readable, cross-platform-safe title for a downloaded file. */
export function sanitizeDownloadTitle(
  value: string | null | undefined,
  fallback = "Clipper Export"
): string {
  const clean = (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\.(?:mp4|mov|webm|mkv|zip)$/i, "")
    .replace(/&/g, " and ")
    .replace(/[^A-Za-z0-9() _-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "")
    .slice(0, 80)
    .trim();

  return clean || fallback;
}

export function platformFilenameLabel(
  platform: PlatformKey | string | null | undefined
): string | null {
  if (!platform) return null;
  if (platform in PLATFORM_FILENAME_LABELS) {
    return PLATFORM_FILENAME_LABELS[platform as PlatformKey];
  }
  return sanitizeDownloadTitle(platform.replace(/_/g, " "), "Platform");
}

export function videoDownloadFilename(
  title: string | null | undefined,
  platform?: PlatformKey | string | null
): string {
  const base = sanitizeDownloadTitle(title);
  const platformLabel = platformFilenameLabel(platform);
  return `${base}${platformLabel ? ` - ${platformLabel}` : ""}.mp4`;
}

export function platformPackDownloadFilename(
  title: string | null | undefined
): string {
  return `${sanitizeDownloadTitle(title)} - Platform Pack.zip`;
}
