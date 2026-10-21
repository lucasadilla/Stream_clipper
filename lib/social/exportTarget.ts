import type { PlatformKey } from "@/lib/platforms/types";
import type { SocialPlatform, SocialPublishSettings } from "./types";

export function socialExportTarget(platform: SocialPlatform, settings: SocialPublishSettings): PlatformKey | null {
  if (platform === "youtube") return settings.youtubeFormat === "standard" ? "youtube_landscape" : "youtube_shorts";
  if (platform === "instagram") return settings.instagramFormat === "feed" ? "instagram_feed" : "instagram_reels";
  if (platform === "facebook") return settings.facebookFormat === "page_video" ? "facebook_feed" : "facebook_reels";
  if (platform === "tiktok") return "tiktok";
  if (platform === "x") return "x";
  return null;
}

export function needsSeparateSocialFormat(target: PlatformKey | null): boolean {
  return target === "x" || target === "youtube_landscape" || target === "facebook_feed" || target === "instagram_feed";
}
