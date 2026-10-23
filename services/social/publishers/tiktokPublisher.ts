import { socialCaption } from "@/lib/social/postText";
import { socialFetch } from "@/lib/social/http";
import { existsSync } from "fs";
import {
  canConnectPlatform,
  forcesPrivateUploads,
  getPlatformCapability,
} from "@/lib/social/capabilities";
import { assertTikTokPostConsent } from "@/lib/social/publishingPolicy";
import { buildPublicVideoUrl } from "./metaOAuth";
import { createPkcePair, publicOrigin } from "@/lib/social/oauth";
import type {
  PublishRequest,
  SocialPublisher,
} from "@/lib/social/SocialPublisher";
import type {
  PublishResult,
  PublishStatus,
  SocialDestination,
  SocialValidationResult,
} from "@/lib/social/types";

const AUTH = "https://www.tiktok.com/v2/auth/authorize/";
const TOKEN = "https://open.tiktokapis.com/v2/oauth/token/";
const API = "https://open.tiktokapis.com/v2";

const SCOPES = [
  "user.info.basic",
  "video.publish",
  "video.upload",
].join(",");

type TikTokPrivacy =
  | "PUBLIC_TO_EVERYONE"
  | "MUTUAL_FOLLOW_FRIENDS"
  | "FOLLOWER_OF_CREATOR"
  | "SELF_ONLY";

export type CreatorInfo = {
  creator_avatar_url?: string;
  creator_username?: string;
  creator_nickname?: string;
  privacy_level_options?: TikTokPrivacy[];
  comment_disabled?: boolean;
  duet_disabled?: boolean;
  stitch_disabled?: boolean;
  max_video_post_duration_sec?: number;
};

type TikTokErrorBody = {
  error?: { code?: string; message?: string; log_id?: string };
  data?: Record<string, unknown>;
};

export function tiktokOAuthConfigured(): boolean {
  return Boolean(
    process.env.TIKTOK_CLIENT_KEY?.trim() &&
      process.env.TIKTOK_CLIENT_SECRET?.trim()
  );
}

export function getTikTokRedirectUri(): string {
  return (
    process.env.TIKTOK_REDIRECT_URI?.trim() ||
    `${publicOrigin()}/api/social/oauth/tiktok/callback`
  );
}

export { createPkcePair };

export function buildTikTokAuthUrl(options: {
  state: string;
  codeChallenge: string;
  performanceAccess?: boolean;
}): string {
  const params = new URLSearchParams({
    client_key: process.env.TIKTOK_CLIENT_KEY!.trim(),
    response_type: "code",
    scope: options.performanceAccess ? `${SCOPES},video.list` : SCOPES,
    redirect_uri: getTikTokRedirectUri(),
    state: options.state,
    code_challenge: options.codeChallenge,
    code_challenge_method: "S256",
  });
  return `${AUTH}?${params.toString()}`;
}

export async function exchangeTikTokCode(options: {
  code: string;
  codeVerifier: string;
}): Promise<{
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  scope: string | null;
  openId: string;
}> {
  const body = new URLSearchParams({
    client_key: process.env.TIKTOK_CLIENT_KEY!.trim(),
    client_secret: process.env.TIKTOK_CLIENT_SECRET!.trim(),
    code: options.code,
    grant_type: "authorization_code",
    redirect_uri: getTikTokRedirectUri(),
    code_verifier: options.codeVerifier,
  });
  const response = await socialFetch(TOKEN, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Cache-Control": "no-cache",
    },
    body,
  });
  const json = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    open_id?: string;
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !json.access_token || !json.open_id) {
    throw new Error(
      json.error_description || json.error || "TikTok token exchange failed"
    );
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresAt: json.expires_in
      ? new Date(Date.now() + json.expires_in * 1000)
      : null,
    scope: json.scope ?? SCOPES,
    openId: json.open_id,
  };
}

export async function refreshTikTokAccessToken(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  scope: string | null;
  openId: string | null;
}> {
  const body = new URLSearchParams({
    client_key: process.env.TIKTOK_CLIENT_KEY!.trim(),
    client_secret: process.env.TIKTOK_CLIENT_SECRET!.trim(),
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const response = await socialFetch(TOKEN, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Cache-Control": "no-cache",
    },
    body,
  });
  const json = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    open_id?: string;
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !json.access_token) {
    throw new Error(
      json.error_description || json.error || "TikTok token refresh failed"
    );
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? refreshToken,
    expiresAt: json.expires_in
      ? new Date(Date.now() + json.expires_in * 1000)
      : null,
    scope: json.scope ?? null,
    openId: json.open_id ?? null,
  };
}

export async function fetchTikTokUser(accessToken: string): Promise<{
  platformAccountId: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  metadata: Record<string, unknown>;
}> {
  const fields = [
    "open_id",
    "avatar_url",
    "display_name",
  ].join(",");
  const response = await socialFetch(`${API}/user/info/?fields=${fields}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = (await response.json()) as TikTokErrorBody & {
    data?: {
      user?: {
        open_id?: string;
        union_id?: string;
        avatar_url?: string;
        display_name?: string;
        username?: string;
      };
    };
  };
  const user = json.data?.user;
  if (!response.ok || !user?.open_id) {
    throw new Error(
      json.error?.message || "Could not load TikTok user profile"
    );
  }
  return {
    platformAccountId: user.open_id,
    displayName: user.display_name || user.username || "TikTok",
    username: user.username ? `@${user.username}` : null,
    avatarUrl: user.avatar_url || null,
    metadata: {
      openId: user.open_id,
      unionId: user.union_id,
      username: user.username,
    },
  };
}

export async function queryCreatorInfo(accessToken: string): Promise<CreatorInfo> {
  const response = await socialFetch(`${API}/post/publish/creator_info/query/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: "{}",
  });
  const json = (await response.json()) as TikTokErrorBody & {
    data?: CreatorInfo;
  };
  if (!response.ok || json.error?.code !== "ok" || !json.data) {
    throw new Error(
      json.error?.message || "Could not query TikTok creator info"
    );
  }
  return json.data;
}

function caption(request: PublishRequest): string { return socialCaption(request.content); }

function resolvePrivacy(request: PublishRequest, options: TikTokPrivacy[] | undefined): TikTokPrivacy {
  const selected = request.settings.tiktokPrivacyLevel as TikTokPrivacy | undefined;
  if (!selected || !options?.includes(selected)) throw new Error("Choose an available TikTok privacy option.");
  if (request.settings.brandedContent === true && selected === "SELF_ONLY") throw new Error("Paid partnership posts cannot use Only me visibility on TikTok.");
  if (forcesPrivateUploads("tiktok") && selected !== "SELF_ONLY") throw new Error("This app currently supports Only me on TikTok. Select that option before posting.");
  return selected;
}

function publishesToInbox(request: PublishRequest): boolean { return request.settings.tiktokMode === "inbox"; }

async function initiateTikTokPost(accessToken: string, request: PublishRequest, creator?: CreatorInfo): Promise<string> {
  const inbox = publishesToInbox(request);
  const body = { source_info: { source: "PULL_FROM_URL", video_url: buildPublicVideoUrl(request.media.filePath) },
    ...(!inbox ? { post_info: {
      title: caption(request), privacy_level: resolvePrivacy(request, creator?.privacy_level_options),
      disable_comment: request.settings.allowComments !== true || creator?.comment_disabled === true,
      disable_duet: request.settings.allowDuet !== true || creator?.duet_disabled === true,
      disable_stitch: request.settings.allowStitch !== true || creator?.stitch_disabled === true,
      brand_content_toggle: request.settings.brandedContent === true,
      brand_organic_toggle: request.settings.brandOrganic === true,
      is_aigc: request.settings.containsSyntheticMedia === true,
    } } : {}),
  };
  await request.checkpoint?.({ committing: true });
  const response = await socialFetch(`${API}/post/publish/${inbox ? "inbox/video" : "video"}/init/`, {
    method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" }, body: JSON.stringify(body),
  });
  const json = await response.json() as TikTokErrorBody & { data?: { publish_id?: string } };
  if (!response.ok || json.error?.code !== "ok" || !json.data?.publish_id) {
    if (response.status >= 400 && response.status < 500 || json.error?.code && json.error.code !== "ok") await request.checkpoint?.({ committing: false });
    throw new Error(json.error?.message || "TikTok could not accept this video");
  }
  const id = json.data.publish_id;
  await request.checkpoint?.({ platformUploadId: id, platformPostId: id, committing: false });
  return id;
}

async function fetchPublishStatus(
  accessToken: string,
  publishId: string
): Promise<{
  status: string;
  failReason?: string;
  publicalyAvailablePostId?: string[];
}> {
  const response = await socialFetch(`${API}/post/publish/status/fetch/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify({ publish_id: publishId }),
  });
  const json = (await response.json()) as TikTokErrorBody & {
    data?: {
      status?: string;
      fail_reason?: string;
      publicaly_available_post_id?: string[];
    };
  };
  if (!response.ok || json.error?.code !== "ok") {
    throw new Error(json.error?.message || "TikTok status fetch failed");
  }
  return {
    status: json.data?.status || "PROCESSING_UPLOAD",
    failReason: json.data?.fail_reason,
    publicalyAvailablePostId: json.data?.publicaly_available_post_id,
  };
}


export const tiktokPublisher: SocialPublisher = {
  platform: "tiktok",

  async validateConnection(ctx) {
    if (!canConnectPlatform("tiktok") || !tiktokOAuthConfigured()) {
      return { ok: false, error: "TikTok publishing is not configured" };
    }
    try {
      const user = await fetchTikTokUser(ctx.accessToken);
      return {
        ok: true,
        displayName: user.displayName,
        username: user.username ?? undefined,
        avatarUrl: user.avatarUrl ?? undefined,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Validation failed";
      return {
        ok: false,
        error: message,
        needsReauth: /unauthorized|401|expired|invalid/i.test(message),
      };
    }
  },

  async getDestinations(ctx): Promise<SocialDestination[]> {
    const user = await fetchTikTokUser(ctx.accessToken);
    return [
      {
        id: user.platformAccountId,
        label: user.username || user.displayName,
        kind: "account",
        metadata: user.metadata,
      },
    ];
  },

  async validatePost(ctx, request): Promise<SocialValidationResult> {
    const warnings: SocialValidationResult["warnings"] = [];
    if (!existsSync(request.media.filePath)) {
      warnings.push({
        code: "missing_file",
        message: "Video file is missing on disk.",
        severity: "error",
      });
    }
    if (getPlatformCapability("tiktok") === "not_configured") {
      warnings.push({
        code: "not_configured",
        message: "TikTok publishing API access is not configured.",
        severity: "error",
      });
    }
    if (forcesPrivateUploads("tiktok") && !publishesToInbox(request)) {
      warnings.push({
        code: "private_only",
        message:
          "Unaudited TikTok apps can only publish as private (SELF_ONLY) until TikTok approves your app.",
        severity: "warning",
      });
    }
    if (publishesToInbox(request)) {
      warnings.push({
        code: "inbox_mode",
        message:
          "Inbox mode sends the video to the creator’s TikTok drafts for manual posting.",
        severity: "info",
      });
    }
    try {
      const info = await queryCreatorInfo(ctx.accessToken);
      if (!publishesToInbox(request)) resolvePrivacy(request, info.privacy_level_options);
      const duration = request.media.durationSeconds;
      if (
        duration != null &&
        info.max_video_post_duration_sec != null &&
        duration > info.max_video_post_duration_sec
      ) {
        warnings.push({
          code: "too_long",
          message: `This clip is longer than this creator’s TikTok max (${info.max_video_post_duration_sec}s).`,
          severity: "error",
        });
      }
    } catch (error) {
      warnings.push({
        code: "creator_info",
        message:
          error instanceof Error
            ? error.message
            : "Could not verify TikTok creator settings.",
        severity: "error",
      });
    }
    return { ok: !warnings.some((w) => w.severity === "error"), warnings };
  },

  async publish(ctx, request): Promise<PublishResult> {
    try {
      assertTikTokPostConsent(request.settings);
      const creator = publishesToInbox(request) ? undefined : await queryCreatorInfo(ctx.accessToken);
      const publishId = request.existingUploadId || await initiateTikTokPost(ctx.accessToken, request, creator);
      const status = await tiktokPublisher.getPublishStatus(ctx, publishId);
      return { success: status.state !== "failed", state: status.state === "published" ? "published" : status.state === "awaiting_user" ? "awaiting_user" : "processing",
        platformUploadId: publishId, platformPostId: status.platformPostId || publishId,
        platformPostUrl: status.platformPostUrl, errorMessage: status.errorMessage,
        privacyStatus: publishesToInbox(request) ? "inbox" : request.settings.tiktokPrivacyLevel,
        errorCode: status.state === "failed" ? "processing_failed" : undefined };
    } catch (error) {
      return { success: false, errorCode: "publish_failed", errorMessage: error instanceof Error ? error.message : "TikTok posting failed" };
    }
  },

  async getPublishStatus(ctx, platformPostId): Promise<PublishStatus> {
    try {
      const status = await fetchPublishStatus(ctx.accessToken, platformPostId);
      if (status.status === "PUBLISH_COMPLETE") {
        const id = status.publicalyAvailablePostId?.[0];
        const username = typeof ctx.accountMetadata?.username === "string" ? ctx.accountMetadata.username.replace(/^@/, "") : null;
        return { state: "published", platformPostId: id || platformPostId, platformPostUrl: id && username ? `https://www.tiktok.com/@${username}/video/${id}` : undefined };
      }
      if (status.status === "SEND_TO_USER_INBOX") {
        return { state: "awaiting_user", platformPostId };
      }
      if (status.status === "FAILED") {
        return {
          state: "failed",
          platformPostId,
          errorMessage: status.failReason,
        };
      }
      return { state: "processing", platformPostId };
    } catch {
      return { state: "unknown", platformPostId };
    }
  },
};
