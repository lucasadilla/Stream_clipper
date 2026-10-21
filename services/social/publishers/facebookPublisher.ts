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

async function publishReel(page: string, token: string, request: PublishRequest): Promise<PublishResult> {
  const description = socialCaption(request.content);
  let session: { videoId: string; uploadUrl: string; uploaded?: boolean } | null = null;
  if (request.existingUploadId) {
    try { session = JSON.parse(request.existingUploadId); } catch { throw new Error("The previous Facebook upload needs review before retrying."); }
  }
  if (!session) {
    const response = await socialFetch(`${GRAPH}/${page}/video_reels`, { method: "POST", body: new URLSearchParams({ upload_phase: "start", access_token: token }) });
    const json = await response.json() as { video_id?: string; upload_url?: string; error?: { message?: string } };
    if (!response.ok || !json.video_id || !json.upload_url) throw new Error(json.error?.message || "Facebook could not initialize the Reel");
    session = { videoId: json.video_id, uploadUrl: json.upload_url };
    await request.checkpoint?.({ platformUploadId: JSON.stringify(session) });
  }
  const uploadUrl = new URL(session.uploadUrl);
  if (uploadUrl.protocol !== "https:" || uploadUrl.hostname !== "rupload.facebook.com") throw new Error("Invalid Facebook upload destination");
  if (!session.uploaded) {
    const upload = await socialFetch(uploadUrl, { method: "POST", headers: {
      Authorization: `OAuth ${token}`, file_url: buildPublicVideoUrl(request.media.filePath),
    } });
    const json = await upload.json() as { success?: boolean; error?: { message?: string } };
    if (!upload.ok || json.success !== true) throw new Error(json.error?.message || "Facebook Reel transfer failed");
    session.uploaded = true;
    await request.checkpoint?.({ platformUploadId: JSON.stringify(session) });
  }
  await request.checkpoint?.({ committing: true });
  const finish = await socialFetch(`${GRAPH}/${page}/video_reels`, { method: "POST", body: new URLSearchParams({
    upload_phase: "finish", video_id: session.videoId, video_state: "PUBLISHED", description, access_token: token,
  }) });
  const json = await finish.json() as { success?: boolean; error?: { message?: string } };
  if (!finish.ok || json.success !== true) {
    if (finish.status >= 400 && finish.status < 500 || json.success === false) await request.checkpoint?.({ committing: false });
    throw new Error(json.error?.message || "Facebook did not accept Reel publication");
  }
  await request.checkpoint?.({ platformPostId: session.videoId, platformMediaId: session.videoId, committing: false });
  return { success: true, state: "processing", platformPostId: session.videoId, platformMediaId: session.videoId };
}

async function publishPageVideo(
  page: string,
  token: string,
  request: PublishRequest
): Promise<PublishResult> {
  const videoUrl = buildPublicVideoUrl(request.media.filePath);
  const description = socialCaption(request.content);
  const params = new URLSearchParams({
    file_url: videoUrl,
    description,
    access_token: token,
    published: "true",
  });
  if (request.content.title) params.set("title", request.content.title);

  await request.checkpoint?.({ committing: true });
  const response = await socialFetch(`${GRAPH}/${page}/videos`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const json = (await response.json()) as {
    id?: string;
    error?: { message?: string };
  };
  if (!response.ok || !json.id) {
    if (response.status >= 400 && response.status < 500) await request.checkpoint?.({ committing: false });
    throw new Error(json.error?.message || "Facebook Page video publish failed");
  }
  await request.checkpoint?.({ platformPostId: json.id, platformMediaId: json.id, committing: false });
  return {
    success: true,
    state: "processing",
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
      const response = await socialFetch(
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

  async getPublishStatus(ctx, platformPostId): Promise<PublishStatus> {
    const response = await socialFetch(`${GRAPH}/${encodeURIComponent(platformPostId)}?fields=status,permalink_url`, {
      headers: { Authorization: `Bearer ${ctx.accessToken}` },
    });
    const json = await response.json() as { status?: { video_status?: string; publishing_phase?: { status?: string; publish_status?: string } }; permalink_url?: string };
    if (!response.ok || !json.status) return { state: "unknown", platformPostId };
    const status = json.status;
    if (["error", "upload_failed", "expired"].includes(status.video_status || "") || status.publishing_phase?.status === "error") {
      return { state: "failed", platformPostId, errorMessage: "Facebook could not process this video" };
    }
    const published = status.publishing_phase?.status === "complete" || status.publishing_phase?.publish_status === "published";
    return { state: published ? "published" : "processing", platformPostId,
      platformPostUrl: published && json.permalink_url ? new URL(json.permalink_url, "https://www.facebook.com").toString() : undefined };
  },
};
