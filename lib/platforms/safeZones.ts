import type { PlatformKey } from "@/lib/platforms/types";

export interface PlatformSafeZone {
  topPercent: number;
  rightPercent: number;
  bottomPercent: number;
  leftPercent: number;
  subtitleBottomPercent: number;
}

const VERTICAL: PlatformSafeZone = {
  topPercent: 10,
  rightPercent: 14,
  bottomPercent: 18,
  leftPercent: 7,
  subtitleBottomPercent: 22,
};

const STANDARD: PlatformSafeZone = {
  topPercent: 6,
  rightPercent: 6,
  bottomPercent: 8,
  leftPercent: 6,
  subtitleBottomPercent: 10,
};

export const PLATFORM_SAFE_ZONES: Record<PlatformKey, PlatformSafeZone> = {
  youtube_shorts: VERTICAL,
  youtube_landscape: STANDARD,
  tiktok: { ...VERTICAL, rightPercent: 16, bottomPercent: 20 },
  instagram_reels: { ...VERTICAL, bottomPercent: 20 },
  instagram_feed: STANDARD,
  facebook_reels: VERTICAL,
  facebook_feed: STANDARD,
  x: STANDARD,
};
