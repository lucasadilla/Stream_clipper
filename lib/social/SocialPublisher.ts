import type {
  PreparedMedia,
  PublishResult,
  PublishStatus,
  SocialDestination,
  SocialGeneratedContent,
  SocialPlatform,
  SocialPublishSettings,
  SocialValidationResult,
} from "@/lib/social/types";

export interface PublisherContext {
  accessToken: string;
  refreshToken?: string | null;
  accountMetadata?: Record<string, unknown> | null;
  destinationId?: string | null;
}

export interface PublishRequest {
  media: PreparedMedia;
  content: SocialGeneratedContent;
  settings: SocialPublishSettings;
  idempotencyKey: string;
  /** Resume an interrupted YouTube resumable upload */
  existingUploadId?: string | null;
  existingPostId?: string | null;
  /** Resume / reuse an X media id */
  existingMediaId?: string | null;
}

export interface SocialPublisher {
  platform: SocialPlatform;
  validateConnection(ctx: PublisherContext): Promise<{
    ok: boolean;
    displayName?: string;
    username?: string;
    avatarUrl?: string;
    error?: string;
    needsReauth?: boolean;
  }>;
  getDestinations(ctx: PublisherContext): Promise<SocialDestination[]>;
  validatePost(
    ctx: PublisherContext,
    request: PublishRequest
  ): Promise<SocialValidationResult>;
  publish(ctx: PublisherContext, request: PublishRequest): Promise<PublishResult>;
  getPublishStatus(
    ctx: PublisherContext,
    platformPostId: string
  ): Promise<PublishStatus>;
}

export class PlatformNotConfiguredError extends Error {
  code = "not_configured";
  constructor(platform: SocialPlatform) {
    super(`${platform} publishing is not configured`);
    this.name = "PlatformNotConfiguredError";
  }
}
