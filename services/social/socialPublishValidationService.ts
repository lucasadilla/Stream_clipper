import { existsSync } from "fs";
import { forcesPrivateUploads } from "@/lib/social/capabilities";
import { socialCaption } from "@/lib/social/postText";
import type {
  PreparedMedia,
  SocialGeneratedContent,
  SocialPlatform,
  SocialPublishSettings,
  SocialValidationResult,
  SocialValidationWarning,
} from "@/lib/social/types";

export function validateSocialPost(options: {
  platform: SocialPlatform;
  content: SocialGeneratedContent;
  settings: SocialPublishSettings;
  media: PreparedMedia | null;
}): SocialValidationResult {
  const warnings: SocialValidationWarning[] = [];
  const { platform, content, settings, media } = options;

  if (!media || !existsSync(media.filePath)) {
    warnings.push({
      code: "missing_media",
      message: "No publishable video file was found. Render or export the clip first.",
      severity: "error",
    });
  }

  if (platform === "youtube") {
    if (!content.title.trim()) {
      warnings.push({
        code: "missing_title",
        message: "YouTube requires a title.",
        severity: "error",
      });
    }
    if (content.title.length > 100) {
      warnings.push({
        code: "title_length",
        message: "YouTube titles must be 100 characters or fewer.",
        severity: "error",
      });
    }
    if (forcesPrivateUploads("youtube") && settings.privacy === "public") {
      warnings.push({
        code: "private_only",
        message:
          "Uploads from this API project are currently limited to private. We will publish as private.",
        severity: "warning",
      });
    }
    if (
      settings.youtubeFormat === "shorts" &&
      media?.width &&
      media?.height &&
      media.width > media.height
    ) {
      warnings.push({
        code: "aspect_mismatch",
        message:
          "This file is landscape but Shorts prefers 9:16. Consider using the YouTube Shorts export.",
        severity: "warning",
      });
    }
  }

  if ((platform === "instagram" || platform === "tiktok") && socialCaption(content).length > 2200) {
    warnings.push({ code: "caption_length", message: "Keep the caption and hashtags within 2,200 characters.", severity: "error" });
  }
  if (platform === "x" && (content.postText || content.caption || content.title).length > 280) {
    warnings.push({ code: "post_length", message: "Keep the X post within 280 characters.", severity: "error" });
  }
  if (platform === "youtube" && content.description.length > 5000) {
    warnings.push({ code: "description_length", message: "Keep the YouTube description within 5,000 characters.", severity: "error" });
  }

  return {
    ok: !warnings.some((w) => w.severity === "error"),
    warnings,
  };
}
