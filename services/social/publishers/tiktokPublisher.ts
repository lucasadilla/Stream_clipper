import { existsSync } from "fs";
import { open, stat } from "fs/promises";
import {
  canConnectPlatform,
  forcesPrivateUploads,
  getPlatformCapability,
} from "@/lib/social/capabilities";
import { createPkcePair, publicOrigin } from "@/lib/social/oauth";
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

const AUTH = "https://www.tiktok.com/v2/auth/authorize/";
const TOKEN = "https://open.tiktokapis.com/v2/oauth/token/";
const API = "https://open.tiktokapis.com/v2";
/** TikTok recommends ~10MB chunks; last chunk may be smaller. */
const CHUNK = 10 * 1024 * 1024;

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

type CreatorInfo = {
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
}): string {
  const params = new URLSearchParams({
    client_key: process.env.TIKTOK_CLIENT_KEY!.trim(),
    response_type: "code",
    scope: SCOPES,
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
  const response = await fetch(TOKEN, {
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
  const response = await fetch(TOKEN, {
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
    "union_id",
    "avatar_url",
    "display_name",
    "username",
  ].join(",");
  const response = await fetch(`${API}/user/info/?fields=${fields}`, {
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

async function queryCreatorInfo(accessToken: string): Promise<CreatorInfo> {
  const response = await fetch(`${API}/post/publish/creator_info/query/`, {
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

function caption(request: PublishRequest): string {
  const content = request.content;
  const text =
    content.caption.trim() ||
    content.postText.trim() ||
    content.title.trim() ||
    "Clip";
  // TikTok title/caption limit is typically 2200 chars; keep conservative.
  return text.slice(0, 2200);
}

function resolvePrivacy(
  request: PublishRequest,
  options: TikTokPrivacy[] | undefined
): TikTokPrivacy {
  if (forcesPrivateUploads("tiktok")) {
    return "SELF_ONLY";
  }
  const requested = request.settings.privacy;
  let level: TikTokPrivacy = "PUBLIC_TO_EVERYONE";
  if (requested === "private") level = "SELF_ONLY";
  else if (requested === "unlisted") level = "MUTUAL_FOLLOW_FRIENDS";
  const allowed = options?.length ? options : (["SELF_ONLY"] as TikTokPrivacy[]);
  if (allowed.includes(level)) return level;
  if (allowed.includes("SELF_ONLY")) return "SELF_ONLY";
  return allowed[0]!;
}

function useInbox(request: PublishRequest): boolean {
  return request.settings.tiktokMode === "inbox";
}

async function initDirectUpload(
  accessToken: string,
  options: {
    title: string;
    privacy: TikTokPrivacy;
    videoSize: number;
    chunkSize: number;
    totalChunkCount: number;
    allowComments: boolean;
    allowDuet: boolean;
    allowStitch: boolean;
  }
): Promise<{ publishId: string; uploadUrl: string }> {
  const response = await fetch(`${API}/post/publish/video/init/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify({
      post_info: {
        title: options.title,
        privacy_level: options.privacy,
        disable_duet: !options.allowDuet,
        disable_comment: !options.allowComments,
        disable_stitch: !options.allowStitch,
        video_cover_timestamp_ms: 1000,
      },
      source_info: {
        source: "FILE_UPLOAD",
        video_size: options.videoSize,
        chunk_size: options.chunkSize,
        total_chunk_count: options.totalChunkCount,
      },
    }),
  });
  const json = (await response.json()) as TikTokErrorBody & {
    data?: { publish_id?: string; upload_url?: string };
  };
  if (
    !response.ok ||
    json.error?.code !== "ok" ||
    !json.data?.publish_id ||
    !json.data.upload_url
  ) {
    throw new Error(json.error?.message || "TikTok direct upload init failed");
  }
  return {
    publishId: json.data.publish_id,
    uploadUrl: json.data.upload_url,
  };
}

async function initInboxUpload(
  accessToken: string,
  options: {
    videoSize: number;
    chunkSize: number;
    totalChunkCount: number;
  }
): Promise<{ publishId: string; uploadUrl: string }> {
  const response = await fetch(`${API}/post/publish/inbox/video/init/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify({
      source_info: {
        source: "FILE_UPLOAD",
        video_size: options.videoSize,
        chunk_size: options.chunkSize,
        total_chunk_count: options.totalChunkCount,
      },
    }),
  });
  const json = (await response.json()) as TikTokErrorBody & {
    data?: { publish_id?: string; upload_url?: string };
  };
  if (
    !response.ok ||
    json.error?.code !== "ok" ||
    !json.data?.publish_id ||
    !json.data.upload_url
  ) {
    throw new Error(json.error?.message || "TikTok inbox upload init failed");
  }
  return {
    publishId: json.data.publish_id,
    uploadUrl: json.data.upload_url,
  };
}

async function putChunks(
  uploadUrl: string,
  filePath: string,
  videoSize: number,
  chunkSize: number
) {
  const handle = await open(filePath, "r");
  try {
    let offset = 0;
    while (offset < videoSize) {
      const end = Math.min(offset + chunkSize, videoSize) - 1;
      const length = end - offset + 1;
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      const response = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": "video/mp4",
          "Content-Length": String(bytesRead),
          "Content-Range": `bytes ${offset}-${offset + bytesRead - 1}/${videoSize}`,
        },
        body: buffer.subarray(0, bytesRead),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(
          `TikTok chunk upload failed (${response.status}): ${text.slice(0, 200)}`
        );
      }
      offset += bytesRead;
    }
  } finally {
    await handle.close();
  }
}

async function fetchPublishStatus(
  accessToken: string,
  publishId: string
): Promise<{
  status: string;
  failReason?: string;
  publicalyAvailablePostId?: string[];
}> {
  const response = await fetch(`${API}/post/publish/status/fetch/`, {
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

async function waitForPublish(
  accessToken: string,
  publishId: string
): Promise<{
  status: string;
  failReason?: string;
  publicalyAvailablePostId?: string[];
}> {
  const terminal = new Set([
    "PUBLISH_COMPLETE",
    "FAILED",
    "SEND_TO_USER_INBOX",
  ]);
  let last = await fetchPublishStatus(accessToken, publishId);
  for (let i = 0; i < 60 && !terminal.has(last.status); i++) {
    await new Promise((r) => setTimeout(r, 2000));
    last = await fetchPublishStatus(accessToken, publishId);
  }
  return last;
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
    if (forcesPrivateUploads("tiktok") && !useInbox(request)) {
      warnings.push({
        code: "private_only",
        message:
          "Unaudited TikTok apps can only publish as private (SELF_ONLY) until TikTok approves your app.",
        severity: "warning",
      });
    }
    if (useInbox(request)) {
      warnings.push({
        code: "inbox_mode",
        message:
          "Inbox mode sends the video to the creator’s TikTok drafts for manual posting.",
        severity: "info",
      });
    }
    try {
      const info = await queryCreatorInfo(ctx.accessToken);
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
        severity: "warning",
      });
    }
    return { ok: !warnings.some((w) => w.severity === "error"), warnings };
  },

  async publish(ctx, request): Promise<PublishResult> {
    try {
      const fileStat = await stat(request.media.filePath);
      const videoSize = fileStat.size;
      const chunkSize = Math.min(CHUNK, videoSize);
      const totalChunkCount = Math.max(1, Math.ceil(videoSize / chunkSize));
      const inbox = useInbox(request);

      let publishId: string;
      let uploadUrl: string;

      if (inbox) {
        const init = await initInboxUpload(ctx.accessToken, {
          videoSize,
          chunkSize,
          totalChunkCount,
        });
        publishId = init.publishId;
        uploadUrl = init.uploadUrl;
      } else {
        const creator = await queryCreatorInfo(ctx.accessToken);
        const privacy = resolvePrivacy(
          request,
          creator.privacy_level_options
        );
        const init = await initDirectUpload(ctx.accessToken, {
          title: caption(request),
          privacy,
          videoSize,
          chunkSize,
          totalChunkCount,
          allowComments: request.settings.allowComments !== false,
          allowDuet:
            request.settings.allowDuet !== false && !creator.duet_disabled,
          allowStitch:
            request.settings.allowStitch !== false && !creator.stitch_disabled,
        });
        publishId = init.publishId;
        uploadUrl = init.uploadUrl;
      }

      await putChunks(uploadUrl, request.media.filePath, videoSize, chunkSize);
      const status = await waitForPublish(ctx.accessToken, publishId);

      if (status.status === "FAILED") {
        return {
          success: false,
          platformUploadId: publishId,
          errorCode: "publish_failed",
          errorMessage: status.failReason || "TikTok publish failed",
        };
      }

      const postId = status.publicalyAvailablePostId?.[0];
      const username =
        typeof ctx.accountMetadata?.username === "string"
          ? String(ctx.accountMetadata.username).replace(/^@/, "")
          : null;

      if (status.status === "SEND_TO_USER_INBOX") {
        return {
          success: true,
          platformUploadId: publishId,
          platformPostId: publishId,
          privacyStatus: "inbox",
          rawSafeResponse: { status: status.status, publishId },
        };
      }

      return {
        success: true,
        platformUploadId: publishId,
        platformPostId: postId || publishId,
        platformPostUrl:
          postId && username
            ? `https://www.tiktok.com/@${username}/video/${postId}`
            : undefined,
        privacyStatus: forcesPrivateUploads("tiktok")
          ? "SELF_ONLY"
          : undefined,
        rawSafeResponse: { status: status.status, publishId, postId },
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "TikTok publish failed";
      return {
        success: false,
        errorCode: /unauthorized|401|expired|scope/i.test(message)
          ? "needs_reauth"
          : "publish_failed",
        errorMessage: message,
        needsReauth: /unauthorized|401|expired|scope/i.test(message),
      };
    }
  },

  async getPublishStatus(ctx, platformPostId): Promise<PublishStatus> {
    try {
      const status = await fetchPublishStatus(ctx.accessToken, platformPostId);
      if (status.status === "PUBLISH_COMPLETE") {
        return { state: "published", platformPostId };
      }
      if (status.status === "SEND_TO_USER_INBOX") {
        return { state: "published", platformPostId };
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
