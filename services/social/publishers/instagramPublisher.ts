import { socialCaption } from "@/lib/social/postText";
import { socialFetch } from "@/lib/social/http";
import { existsSync } from "fs";
import {
  canConnectPlatform,
  getPlatformCapability,
} from "@/lib/social/capabilities";
import type {
  PublishRequest,
  PublisherContext,
  SocialPublisher,
} from "@/lib/social/SocialPublisher";
import type {
  PublishResult,
  PublishStatus,
  SocialDestination,
  SocialValidationResult,
} from "@/lib/social/types";
import {
  buildPublicVideoUrl,
  GRAPH,
  metaOAuthConfigured,
} from "@/services/social/publishers/metaOAuth";

function pageToken(ctx: PublisherContext): string {
  const meta = ctx.accountMetadata || {};
  if (typeof meta.pageAccessToken === "string" && meta.pageAccessToken) {
    return meta.pageAccessToken;
  }
  return ctx.accessToken;
}

function igUserId(ctx: PublisherContext): string {
  return String(ctx.destinationId || ctx.accountMetadata?.igUserId || "");
}

async function createVideoContainer(igId: string, accessToken: string, request: PublishRequest): Promise<string> {
  const params = new URLSearchParams({
    media_type: "REELS", video_url: buildPublicVideoUrl(request.media.filePath),
    caption: socialCaption(request.content),
    share_to_feed: String(request.settings.shareToFeed !== false), access_token: accessToken,
  });
  const response = await socialFetch(`${GRAPH}/${igId}/media`, { method: "POST", body: params });
  const json = await response.json() as { id?: string; error?: { message?: string } };
  if (!response.ok || !json.id) throw new Error(json.error?.message || "Instagram could not prepare this video");
  return json.id;
}

async function containerStatus(containerId: string, token: string): Promise<string> {
  const response = await socialFetch(`${GRAPH}/${containerId}?fields=status_code,status`, { headers: { Authorization: `Bearer ${token}` } });
  const json = await response.json() as { status_code?: string; status?: string; error?: { message?: string } };
  if (!response.ok) throw new Error(json.error?.message || "Could not check Instagram processing");
  if (["ERROR", "EXPIRED"].includes(json.status_code || "")) throw new Error(json.status || "Instagram video processing failed");
  return json.status_code || "IN_PROGRESS";
}

async function publishContainer(
  igId: string,
  containerId: string,
  accessToken: string,
  checkpoint: PublishRequest["checkpoint"]
): Promise<string> {
  const params = new URLSearchParams({
    creation_id: containerId,
    access_token: accessToken,
  });
  const response = await socialFetch(`${GRAPH}/${igId}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const json = (await response.json()) as {
    id?: string;
    error?: { message?: string };
  };
  if (!response.ok || !json.id) {
    if (response.status >= 400 && response.status < 500 || json.error) await checkpoint?.({ committing: false });
    throw new Error(json.error?.message || "Instagram publish failed");
  }
  return json.id;
}

async function fetchPermalink(
  mediaId: string,
  accessToken: string
): Promise<string | null> {
  const response = await socialFetch(
    `${GRAPH}/${mediaId}?fields=permalink&access_token=${encodeURIComponent(accessToken)}`
  );
  const json = (await response.json()) as { permalink?: string };
  return response.ok ? json.permalink || null : null;
}

export const instagramPublisher: SocialPublisher = {
  platform: "instagram",

  async validateConnection(ctx) {
    if (!canConnectPlatform("instagram") || !metaOAuthConfigured()) {
      return { ok: false, error: "Instagram publishing is not configured" };
    }
    const igId = igUserId(ctx);
    if (!igId) {
      return {
        ok: false,
        error: "Instagram professional account required",
        needsReauth: true,
      };
    }
    try {
      const token = pageToken(ctx);
      const response = await socialFetch(
        `${GRAPH}/${igId}?fields=id,username,name&access_token=${encodeURIComponent(token)}`
      );
      const json = (await response.json()) as {
        id?: string;
        username?: string;
        name?: string;
        error?: { message?: string };
      };
      if (!response.ok || !json.id) {
        return {
          ok: false,
          error: json.error?.message || "Instagram validation failed",
          needsReauth: true,
        };
      }
      return {
        ok: true,
        displayName: json.name || json.username || "Instagram",
        username: json.username ? `@${json.username}` : undefined,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Validation failed";
      return { ok: false, error: message, needsReauth: true };
    }
  },

  async getDestinations(ctx): Promise<SocialDestination[]> {
    const igId = igUserId(ctx);
    const username =
      typeof ctx.accountMetadata?.username === "string"
        ? ctx.accountMetadata.username
        : "Instagram";
    return [
      {
        id: igId,
        label: String(username),
        kind: "instagram_professional",
      },
    ];
  },

  async validatePost(_ctx, request): Promise<SocialValidationResult> {
    const warnings: SocialValidationResult["warnings"] = [];
    if (!existsSync(request.media.filePath)) {
      warnings.push({
        code: "missing_file",
        message: "Video file is missing on disk.",
        severity: "error",
      });
    }
    if (getPlatformCapability("instagram") === "not_configured") {
      warnings.push({
        code: "not_configured",
        message: "Instagram publishing is not configured.",
        severity: "error",
      });
    }
    if (
      request.settings.instagramFormat !== "feed" &&
      request.media.width &&
      request.media.height &&
      request.media.width > request.media.height
    ) {
      warnings.push({
        code: "aspect",
        message: "Reels prefer vertical 9:16. Consider using the Instagram Reels export.",
        severity: "warning",
      });
    }
    warnings.push({
      code: "pro_required",
      message: "A professional Instagram account linked to a Facebook Page is required.",
      severity: "info",
    });
    return { ok: !warnings.some((w) => w.severity === "error"), warnings };
  },

  async publish(ctx, request): Promise<PublishResult> {
    try {
      const igId = igUserId(ctx);
      const token = pageToken(ctx);
      if (!igId) {
        return {
          success: false,
          errorCode: "needs_reauth",
          errorMessage: "Instagram professional account required",
          needsReauth: true,
        };
      }

      const containerId = request.existingUploadId || await createVideoContainer(igId, token, request);
      await request.checkpoint?.({ platformUploadId: containerId });
      const code = await containerStatus(containerId, token);
      if (code === "PUBLISHED") {
        await request.checkpoint?.({ committing: true });
        return { success: false, errorCode: "outcome_unknown", errorMessage: "Instagram already published this container. Check the account before posting again." };
      }
      if (code !== "FINISHED") return { success: true, state: "processing", platformUploadId: containerId };
      await request.checkpoint?.({ committing: true });
      const mediaId = await publishContainer(igId, containerId, token, request.checkpoint);
      await request.checkpoint?.({ platformPostId: mediaId, platformMediaId: mediaId, committing: false });
      const permalink = await fetchPermalink(mediaId, token);
      return { success: true, state: permalink ? "published" : "processing",
        platformUploadId: containerId, platformMediaId: mediaId, platformPostId: mediaId,
        platformPostUrl: permalink || undefined, rawSafeResponse: { containerId, mediaId } };

    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Instagram publish failed";
      return {
        success: false,
        errorCode: /auth|token|permission|oauth/i.test(message)
          ? "needs_reauth"
          : "publish_failed",
        errorMessage: message,
        needsReauth: /auth|token|permission|oauth/i.test(message),
      };
    }
  },

  async getPublishStatus(ctx, platformPostId): Promise<PublishStatus> {
    const token = pageToken(ctx);
    const permalink = await fetchPermalink(platformPostId, token);
    return {
      state: permalink ? "published" : "unknown",
      platformPostId,
      platformPostUrl: permalink || undefined,
    };
  },
};
