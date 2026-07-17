export const SOCIAL_PLATFORMS = [
  "youtube",
  "tiktok",
  "instagram",
  "facebook",
  "x",
  "reddit",
] as const;

export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export type SocialCapabilityStatus =
  | "not_configured"
  | "development_only"
  | "awaiting_review"
  | "private_test_only"
  | "production_ready"
  | "temporarily_disabled";

export type SocialContentTone =
  | "natural"
  | "funny"
  | "hype"
  | "informative"
  | "professional"
  | "minimal";

export type EmojiLevel = "none" | "low" | "normal";
export type HashtagLevel = "none" | "minimal" | "normal";

export interface SocialGeneratedContent {
  platform: SocialPlatform;
  title: string;
  caption: string;
  description: string;
  postText: string;
  hashtags: string[];
  tags: string[];
  thumbnailText: string;
  pinnedComment: string;
  redditTitle: string;
  redditBody: string;
  contentWarning: boolean;
  reasoningSummary: string;
}

export interface SocialPublishSettings {
  privacy?: "private" | "unlisted" | "public";
  categoryId?: string;
  madeForKids?: boolean;
  notifySubscribers?: boolean;
  containsSyntheticMedia?: boolean;
  scheduledFor?: string | null;
  allowComments?: boolean;
  allowDuet?: boolean;
  allowStitch?: boolean;
  shareToFeed?: boolean;
  youtubeFormat?: "shorts" | "standard";
  facebookFormat?: "reel" | "page_video";
  /** Direct post vs send to creator inbox drafts */
  tiktokMode?: "direct" | "inbox";
  playlistId?: string | null;
  [key: string]: unknown;
}

export interface SocialValidationWarning {
  code: string;
  message: string;
  severity: "info" | "warning" | "error";
}

export interface SocialValidationResult {
  ok: boolean;
  warnings: SocialValidationWarning[];
}

export interface SocialDestination {
  id: string;
  label: string;
  kind: string;
  metadata?: Record<string, unknown>;
}

export interface PreparedMedia {
  filePath: string;
  mimeType: string;
  fileSizeBytes: number;
  width?: number | null;
  height?: number | null;
  durationSeconds?: number | null;
  platformExportId?: string | null;
}

export interface PublishResult {
  success: boolean;
  platformPostId?: string;
  platformMediaId?: string;
  platformUploadId?: string;
  platformPostUrl?: string;
  privacyStatus?: string;
  rawSafeResponse?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
  needsReauth?: boolean;
}

export interface PublishStatus {
  state: "uploading" | "processing" | "published" | "failed" | "unknown";
  platformPostId?: string;
  platformPostUrl?: string;
  privacyStatus?: string;
  errorMessage?: string;
}

export function isSocialPlatform(value: string): value is SocialPlatform {
  return (SOCIAL_PLATFORMS as readonly string[]).includes(value);
}

export function emptySocialContent(
  platform: SocialPlatform
): SocialGeneratedContent {
  return {
    platform,
    title: "",
    caption: "",
    description: "",
    postText: "",
    hashtags: [],
    tags: [],
    thumbnailText: "",
    pinnedComment: "",
    redditTitle: "",
    redditBody: "",
    contentWarning: false,
    reasoningSummary: "",
  };
}
