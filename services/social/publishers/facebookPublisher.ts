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

function pageId(ctx: PublisherContext): string {
  return String(ctx.destinationId || ctx.accountMetadata?.pageId || "");
}

function wantsReel(request: PublishRequest): boolean {
  const format = request.settings.facebookFormat;
  if (format === "reel") return true;
  if (format === "page_video") return false;
  const w = request.media.width;
  const h = request.media.height;
  return Boolean(w && h && h > w);
}

async function publishReel(
  page: string,
  token: string,
  request: PublishRequest
): Promise<PublishResult> {
  const videoUrl = buildPublicVideoUrl(request.media.filePath);
  const description =
    request.content.caption ||
    request.content.description ||
    request.content.title ||
    "";

  const start = await fetch(`${GRAPH}/${page}/video_reels`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      upload_phase: "start",
      access_token: token,
    }),
  });
  const startJson = (await start.json()) as {
    video_id?: string;
    upload_url?: string;
    error?: { message?: string };
  };

  // Prefer hosted URL finish when start/upload_url is awkward from our host.
  if (!start.ok || !startJson.video_id || !startJson.upload_url) {
    const create = await fetch(`${GRAPH}/${page}/video_reels`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        upload_phase: "finish",
        video_url: videoUrl,
        description,
        access_token: token,
        video_state: "PUBLISHED",
      }),
    });
    const createJson = (await create.json()) as {
      id?: string;
      video_id?: string;
      error?: { message?: string };
    };
    if (!create.ok || !(createJson.id || createJson.video_id)) {
      throw new Error(
        createJson.error?.message ||
          startJson.error?.message ||
          "Facebook Reel publish failed"
      );
    }
    const id = String(createJson.id || createJson.video_id);
    return {
      success: true,
      platformPostId: id,
      platformMediaId: id,
      platformPostUrl: `https://www.facebook.com/reel/${id}`,
    };
  }

  // Tell Meta to pull from our short-lived public grant URL.
  const upload = await fetch(startJson.upload_url, {
    method: "POST",
    headers: {
      Authorization: `OAuth ${token}`,
      file_url: videoUrl,
    },
  });
  if (!upload.ok) {
    const text = await upload.text();
    throw new Error(`Facebook Reel upload failed: ${text.slice(0, 300)}`);
  }

  const finish = await fetch(`${GRAPH}/${page}/video_reels`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      upload_phase: "finish",
      video_id: startJson.video_id,
      video_state: "PUBLISHED",
      description,
      access_token: token,
    }),
  });
  const finishJson = (await finish.json()) as {
    success?: boolean;
    error?: { message?: string };
  };
  if (!finish.ok) {
    throw new Error(finishJson.error?.message || "Facebook Reel finish failed");
  }
  return {
    success: true,
    platformPostId: startJson.video_id,
    platformMediaId: startJson.video_id,
    platformUploadId: startJson.video_id,
    platformPostUrl: `https://www.facebook.com/reel/${startJson.video_id}`,
  };
}

async function publishPageVideo(
  page: string,
  token: string,
  request: PublishRequest
): Promise<PublishResult> {
  const videoUrl = buildPublicVideoUrl(request.media.filePath);
  const description =
    request.content.caption ||
    request.content.description ||
    request.content.title ||
    "";
  const params = new URLSearchParams({
    file_url: videoUrl,
    description,
    access_token: token,
    published: "true",
  });
  if (request.content.title) params.set("title", request.content.title);

  const response = await fetch(`${GRAPH}/${page}/videos`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const json = (await response.json()) as {
    id?: string;
    error?: { message?: string };
  };
  if (!response.ok || !json.id) {
    throw new Error(json.error?.message || "Facebook Page video publish failed");
  }
  return {
    success: true,
    platformPostId: json.id,
    platformMediaId: json.id,
    platformPostUrl: `https://www.facebook.com/watch/?v=${json.id}`,
  };
}

export const facebookPublisher: SocialPublisher = {
  platform: "facebook",

  async validateConnection(ctx) {
    if (!canConnectPlatform("facebook") || !metaOAuthConfigured()) {
      return { ok: false, error: "Facebook publishing is not configured" };
    }
    const id = pageId(ctx);
    if (!id) {
      return { ok: false, error: "Facebook Page required", needsReauth: true };
    }
    try {
      const response = await fetch(
        `${GRAPH}/${id}?fields=id,name&access_token=${encodeURIComponent(ctx.accessToken)}`
      );
      const json = (await response.json()) as {
        id?: string;
        name?: string;
        error?: { message?: string };
      };
      if (!response.ok || !json.id) {
        return {
          ok: false,
          error: json.error?.message || "Facebook Page validation failed",
          needsReauth: true,
        };
      }
      return { ok: true, displayName: json.name || "Facebook Page" };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Validation failed";
      return { ok: false, error: message, needsReauth: true };
    }
  },

  async getDestinations(ctx): Promise<SocialDestination[]> {
    const id = pageId(ctx);
    return [
      {
        id,
        label:
          typeof ctx.accountMetadata?.pageName === "string"
            ? ctx.accountMetadata.pageName
            : "Facebook Page",
        kind: "page",
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
    if (getPlatformCapability("facebook") === "not_configured") {
      warnings.push({
        code: "not_configured",
        message: "Facebook publishing is not configured.",
        severity: "error",
      });
    }
    warnings.push({
      code: "page_required",
      message:
        "Publishing targets a Facebook Page you manage, not a personal profile.",
      severity: "info",
    });
    return { ok: !warnings.some((w) => w.severity === "error"), warnings };
  },

  async publish(ctx, request): Promise<PublishResult> {
    try {
      const page = pageId(ctx);
      if (!page) {
        return {
          success: false,
          errorCode: "needs_reauth",
          errorMessage: "Facebook Page required",
          needsReauth: true,
        };
      }
      if (wantsReel(request)) {
        return await publishReel(page, ctx.accessToken, request);
      }
      return await publishPageVideo(page, ctx.accessToken, request);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Facebook publish failed";
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

  async getPublishStatus(_ctx, platformPostId): Promise<PublishStatus> {
    return {
      state: "published",
      platformPostId,
      platformPostUrl: `https://www.facebook.com/watch/?v=${platformPostId}`,
    };
  },
};
