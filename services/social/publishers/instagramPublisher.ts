import { existsSync } from "fs";
import { readFile, stat } from "fs/promises";
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

async function createReelContainer(
  igId: string,
  accessToken: string,
  request: PublishRequest
): Promise<{ containerId: string; usedResumable: boolean }> {
  const caption =
    request.content.caption ||
    request.content.postText ||
    request.content.title ||
    "";

  // Prefer resumable upload (no public URL required).
  const resumableParams = new URLSearchParams({
    media_type: "REELS",
    upload_type: "resumable",
    caption,
    access_token: accessToken,
  });
  if (request.settings.shareToFeed === false) {
    resumableParams.set("share_to_feed", "false");
  }

  let response = await fetch(`${GRAPH}/${igId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: resumableParams,
  });
  let json = (await response.json()) as {
    id?: string;
    uri?: string;
    error?: { message?: string; code?: number };
  };

  if (response.ok && json.id) {
    return { containerId: json.id, usedResumable: true };
  }

  // Fallback: public video_url grant
  const videoUrl = buildPublicVideoUrl(request.media.filePath);
  const urlParams = new URLSearchParams({
    media_type: "REELS",
    video_url: videoUrl,
    caption,
    access_token: accessToken,
  });
  response = await fetch(`${GRAPH}/${igId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: urlParams,
  });
  json = (await response.json()) as {
    id?: string;
    error?: { message?: string };
  };
  if (!response.ok || !json.id) {
    throw new Error(
      json.error?.message ||
        "Instagram could not create a Reel media container"
    );
  }
  return { containerId: json.id, usedResumable: false };
}

async function uploadResumableVideo(
  containerId: string,
  accessToken: string,
  filePath: string
) {
  const fileStat = await stat(filePath);
  const bytes = await readFile(filePath);
  const response = await fetch(
    `https://rupload.facebook.com/ig-api-upload/v21.0/${containerId}`,
    {
      method: "POST",
      headers: {
        Authorization: `OAuth ${accessToken}`,
        offset: "0",
        file_size: String(fileStat.size),
        "Content-Type": "application/octet-stream",
      },
      body: bytes,
    }
  );
  const json = (await response.json().catch(() => ({}))) as {
    success?: boolean;
    message?: string;
    debug_info?: { message?: string };
  };
  if (!response.ok || json.success === false) {
    throw new Error(
      json.debug_info?.message ||
        json.message ||
        "Instagram resumable video upload failed"
    );
  }
}

async function waitForContainer(
  containerId: string,
  accessToken: string
): Promise<void> {
  for (let i = 0; i < 40; i++) {
    const response = await fetch(
      `${GRAPH}/${containerId}?fields=status_code,status&access_token=${encodeURIComponent(accessToken)}`
    );
    const json = (await response.json()) as {
      status_code?: string;
      status?: string;
      error?: { message?: string };
    };
    const code = json.status_code;
    if (code === "FINISHED") return;
    if (code === "ERROR" || code === "EXPIRED") {
      throw new Error(
        json.status || json.error?.message || "Instagram container processing failed"
      );
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error("Timed out waiting for Instagram media processing");
}

async function publishContainer(
  igId: string,
  containerId: string,
  accessToken: string
): Promise<string> {
  const params = new URLSearchParams({
    creation_id: containerId,
    access_token: accessToken,
  });
  const response = await fetch(`${GRAPH}/${igId}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const json = (await response.json()) as {
    id?: string;
    error?: { message?: string };
  };
  if (!response.ok || !json.id) {
    throw new Error(json.error?.message || "Instagram publish failed");
  }
  return json.id;
}

async function fetchPermalink(
  mediaId: string,
  accessToken: string
): Promise<string | null> {
  const response = await fetch(
    `${GRAPH}/${mediaId}?fields=permalink&access_token=${encodeURIComponent(accessToken)}`
  );
  const json = (await response.json()) as { permalink?: string };
  return json.permalink || null;
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
      const response = await fetch(
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

      let containerId = request.existingUploadId || null;
      let usedResumable = true;
      if (!containerId) {
        const created = await createReelContainer(igId, token, request);
        containerId = created.containerId;
        usedResumable = created.usedResumable;
        if (usedResumable) {
          await uploadResumableVideo(containerId, token, request.media.filePath);
        }
      }

      await waitForContainer(containerId, token);
      const mediaId = await publishContainer(igId, containerId, token);
      const permalink = await fetchPermalink(mediaId, token);

      return {
        success: true,
        platformUploadId: containerId,
        platformMediaId: mediaId,
        platformPostId: mediaId,
        platformPostUrl: permalink || `https://www.instagram.com/reel/${mediaId}/`,
        rawSafeResponse: { containerId, mediaId, usedResumable },
      };
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
      state: "published",
      platformPostId,
      platformPostUrl: permalink || undefined,
    };
  },
};
