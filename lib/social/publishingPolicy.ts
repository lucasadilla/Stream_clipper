import type { SocialPlatform, SocialPublishSettings } from "./types";

export const EDITABLE_PUBLISH_STATUSES = ["draft", "awaiting_consent"];
export const ACTIVE_PUBLISH_STATUSES = ["preparing_media", "uploading", "processing", "publishing"];

export function requiresPostReview(platform: SocialPlatform): boolean {
  // TikTok's Direct Post UX requires review and explicit consent for each clip.
  return platform === "tiktok";
}

export function socialGroupStatus(statuses: string[]): string {
  if (!statuses.length) return "awaiting_review";
  if (statuses.every((s) => s === "cancelled")) return "cancelled";
  if (statuses.every((s) => s === "completed" || s === "cancelled")) return "completed";
  if (statuses.some((s) => [...ACTIVE_PUBLISH_STATUSES, "queued"].includes(s))) return "publishing";
  if (statuses.some((s) => s === "scheduled")) return "scheduled";
  if (statuses.some((s) => ["draft", "awaiting_consent", "awaiting_user", "outcome_unknown"].includes(s))) return "awaiting_review";
  if (statuses.some((s) => s === "completed")) return "partially_completed";
  return "failed";
}

export function safeSocialRedirect(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\r\n\x00]/.test(value)) {
    return "/settings/connected-accounts";
  }
  try {
    const url = new URL(value, "https://clipper.invalid");
    if (url.origin !== "https://clipper.invalid") return "/settings/connected-accounts";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/settings/connected-accounts";
  }
}

export function assertTikTokPostConsent(settings: SocialPublishSettings) {
  if (settings.postConsent !== true || settings.musicUsageConfirmed !== true) {
    throw new Error("Review the video and confirm TikTok's music usage terms before posting.");
  }
  if (settings.tiktokMode !== "inbox" && !settings.tiktokPrivacyLevel) {
    throw new Error("Choose who can view this TikTok post.");
  }
}

export function safePublishError(message: string): string {
  return message
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[platform URL]")
    .replace(/(bearer\s+)[\w.\-]+/gi, "$1[redacted]")
    .replace(/((?:access_token|refresh_token|client_secret|authorization)\s*[=:]\s*)[^\s,&"}]+/gi, "$1[redacted]")
    .slice(0, 600);
}
