import { existsSync } from "fs";
import { forcesPrivateUploads } from "@/lib/social/capabilities";
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

  return {
    ok: !warnings.some((w) => w.severity === "error"),
    warnings,
  };
}
