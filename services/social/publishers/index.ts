import type { SocialPublisher } from "@/lib/social/SocialPublisher";
import type { SocialPlatform } from "@/lib/social/types";
import { youtubePublisher } from "@/services/social/publishers/youtubePublisher";
import { xPublisher } from "@/services/social/publishers/xPublisher";
import { instagramPublisher } from "@/services/social/publishers/instagramPublisher";
import { facebookPublisher } from "@/services/social/publishers/facebookPublisher";
import { tiktokPublisher } from "@/services/social/publishers/tiktokPublisher";
import {
  PlatformNotConfiguredError,
  type PublishRequest,
  type PublisherContext,
} from "@/lib/social/SocialPublisher";

function stubPublisher(platform: SocialPlatform): SocialPublisher {
  return {
    platform,
    async validateConnection() {
      return {
        ok: false,
        error: `${platform} publishing is not configured`,
        needsReauth: false,
      };
    },
    async getDestinations() {
      return [];
    },
    async validatePost() {
      return {
        ok: false,
        warnings: [
          {
            code: "not_configured",
            message: `${platform} publishing is not configured yet.`,
            severity: "error",
          },
        ],
      };
    },
    async publish(_ctx: PublisherContext, _request: PublishRequest) {
      throw new PlatformNotConfiguredError(platform);
    },
    async getPublishStatus() {
      return { state: "unknown" };
    },
  };
}

const PUBLISHERS: Record<SocialPlatform, SocialPublisher> = {
  youtube: youtubePublisher,
  tiktok: tiktokPublisher,
  instagram: instagramPublisher,
  facebook: facebookPublisher,
  x: xPublisher,
  reddit: stubPublisher("reddit"),
};

export function getSocialPublisher(platform: SocialPlatform): SocialPublisher {
  return PUBLISHERS[platform];
}
