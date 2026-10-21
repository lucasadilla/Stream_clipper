import { socialFetch } from "@/lib/social/http";
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
  SocialPublisher,
} from "@/lib/social/SocialPublisher";
import type {
  PublishResult,
  PublishStatus,
  SocialDestination,
  SocialValidationResult,
} from "@/lib/social/types";

const AUTH = "https://twitter.com/i/oauth2/authorize";
const TOKEN = "https://api.x.com/2/oauth2/token";
const API = "https://api.x.com/2";
const MEDIA = "https://api.x.com/2/media/upload";
const CHUNK = 4.5 * 1024 * 1024;

const SCOPES = [
  "tweet.read",
  "tweet.write",
  "users.read",
  "offline.access",
  "media.write",
].join(" ");

export function xOAuthConfigured(): boolean {
  return Boolean(
    process.env.X_CLIENT_ID?.trim() && process.env.X_CLIENT_SECRET?.trim()
  );
}

export function getXRedirectUri(): string {
  return (
    process.env.X_REDIRECT_URI?.trim() ||
    `${publicOrigin()}/api/social/oauth/x/callback`
  );
}

export { createPkcePair };

export function buildXAuthUrl(options: {
  state: string;
  codeChallenge: string;
}): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.X_CLIENT_ID!.trim(),
    redirect_uri: getXRedirectUri(),
    scope: SCOPES,
    state: options.state,
    code_challenge: options.codeChallenge,
    code_challenge_method: "S256",
  });
  return `${AUTH}?${params.toString()}`;
}

function basicAuthHeader(): string {
  const id = process.env.X_CLIENT_ID!.trim();
  const secret = process.env.X_CLIENT_SECRET!.trim();
  return `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
}

export async function exchangeXCode(options: {
  code: string;
  codeVerifier: string;
}): Promise<{
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  scope: string | null;
}> {
  const body = new URLSearchParams({
    code: options.code,
    grant_type: "authorization_code",
    redirect_uri: getXRedirectUri(),
    code_verifier: options.codeVerifier,
  });
  const response = await socialFetch(TOKEN, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const json = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !json.access_token) {
    throw new Error(json.error_description || json.error || "X token exchange failed");
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresAt: json.expires_in
      ? new Date(Date.now() + json.expires_in * 1000)
      : null,
    scope: json.scope ?? SCOPES,
  };
}

export async function refreshXAccessToken(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  scope: string | null;
}> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const response = await socialFetch(TOKEN, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const json = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !json.access_token) {
    throw new Error(json.error_description || json.error || "X token refresh failed");
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? refreshToken,
    expiresAt: json.expires_in
      ? new Date(Date.now() + json.expires_in * 1000)
      : null,
    scope: json.scope ?? null,
  };
}

export async function fetchXUser(accessToken: string): Promise<{
  platformAccountId: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  metadata: Record<string, unknown>;
}> {
  const response = await socialFetch(`${API}/users/me?user.fields=profile_image_url,name,username`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = (await response.json()) as {
    data?: {
      id: string;
      name?: string;
      username?: string;
      profile_image_url?: string;
    };
    detail?: string;
    title?: string;
  };
  if (!response.ok || !json.data?.id) {
    throw new Error(json.detail || json.title || "Could not load X user");
  }
  return {
    platformAccountId: json.data.id,
    displayName: json.data.name || json.data.username || "X account",
    username: json.data.username ? `@${json.data.username}` : null,
    avatarUrl: json.data.profile_image_url || null,
    metadata: { userId: json.data.id },
  };
}

async function initMedia(
  accessToken: string,
  totalBytes: number
): Promise<string> {
  const response = await socialFetch(`${MEDIA}/initialize`, {
    method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ media_type: "video/mp4", total_bytes: totalBytes, media_category: "tweet_video" }),
  });
  const json = (await response.json()) as {
    media_id_string?: string;
    data?: { id?: string };
    detail?: string;
  };
  const id = json.media_id_string || json.data?.id;
  if (!response.ok || !id) {
    throw new Error(json.detail || "X media INIT failed");
  }
  return String(id);
}

async function appendChunk(
  accessToken: string,
  mediaId: string,
  segmentIndex: number,
  chunk: Buffer
) {
  const form = new FormData();
  form.set("segment_index", String(segmentIndex));
  form.set("media", new Blob([new Uint8Array(chunk)]), `chunk_${segmentIndex}.bin`);
  const response = await socialFetch(`${MEDIA}/${encodeURIComponent(mediaId)}/append`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });
  if (!response.ok && response.status !== 204) {
    const text = await response.text();
    throw new Error(`X media APPEND failed: ${text.slice(0, 300)}`);
  }
}

async function finalizeMedia(accessToken: string, mediaId: string) {
  const response = await socialFetch(`${MEDIA}/${encodeURIComponent(mediaId)}/finalize`, {
    method: "POST", headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = (await response.json()) as {
    data?: { processing_info?: { state?: string; check_after_secs?: number; error?: { message?: string } } };
    detail?: string;
  };
  if (!response.ok) {
    throw new Error(json.detail || "X media FINALIZE failed");
  }
  return json.data?.processing_info;
}

async function mediaReady(accessToken: string, mediaId: string): Promise<boolean> {
  const response = await socialFetch(`${MEDIA}?media_id=${encodeURIComponent(mediaId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = await response.json() as { data?: { processing_info?: { state?: string; error?: { message?: string } } }; detail?: string };
  if (!response.ok || !json.data) throw new Error(json.detail || "Could not check X media processing");
  const processing = json.data.processing_info;
  if (processing?.state === "failed") throw new Error(processing.error?.message || "X media processing failed");
  return !processing || processing.state === "succeeded";
}

async function uploadVideo(accessToken: string, filePath: string): Promise<string> {
  const fileStat = await stat(filePath);
  const mediaId = await initMedia(accessToken, fileStat.size);
  const handle = await open(filePath, "r");
  try {
    let offset = 0;
    let segment = 0;
    const buffer = Buffer.alloc(CHUNK);
    while (offset < fileStat.size) {
      const { bytesRead } = await handle.read(
        buffer,
        0,
        Math.min(CHUNK, fileStat.size - offset),
        offset
      );
      if (!bytesRead) throw new Error("Video file ended during X upload");
      await appendChunk(accessToken, mediaId, segment, buffer.subarray(0, bytesRead));
      offset += bytesRead;
      segment += 1;
    }
  } finally {
    await handle.close();
  }
  await finalizeMedia(accessToken, mediaId);
  return mediaId;
}

function postText(request: PublishRequest): string {
  const content = request.content;
  const text =
    content.postText.trim() ||
    content.caption.trim() ||
    content.title.trim() ||
    "Clip";
  return text;
}

export const xPublisher: SocialPublisher = {
  platform: "x",

  async validateConnection(ctx) {
    if (!canConnectPlatform("x") || !xOAuthConfigured()) {
      return { ok: false, error: "X publishing is not configured" };
    }
    try {
      const user = await fetchXUser(ctx.accessToken);
      return {
        ok: true,
        displayName: user.displayName,
        username: user.username ?? undefined,
        avatarUrl: user.avatarUrl ?? undefined,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Validation failed";
      return {
        ok: false,
        error: message,
        needsReauth: /unauthorized|401|expired|invalid/i.test(message),
      };
    }
  },

  async getDestinations(ctx): Promise<SocialDestination[]> {
    const user = await fetchXUser(ctx.accessToken);
    return [
      {
        id: user.platformAccountId,
        label: user.username || user.displayName,
        kind: "account",
        metadata: user.metadata,
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
    const text = postText(request);
    if (!text.trim()) {
      warnings.push({
        code: "empty_text",
        message: "X posts need text or a clear caption.",
        severity: "error",
      });
    }
    if (text.length > 280) {
      warnings.push({
        code: "text_too_long",
        message: "Post text exceeds 280 characters for this account.",
        severity: "error",
      });
    }
    if (getPlatformCapability("x") === "not_configured") {
      warnings.push({
        code: "not_configured",
        message: "X publishing API access is not configured.",
        severity: "error",
      });
    }
    if (forcesPrivateUploads("x")) {
      warnings.push({
        code: "dev_only",
        message: "X publishing may be limited by your API access tier.",
        severity: "warning",
      });
    }
    return { ok: !warnings.some((w) => w.severity === "error"), warnings };
  },

  async publish(ctx, request): Promise<PublishResult> {
    try {
      const mediaId =
        request.existingMediaId ||
        (await uploadVideo(ctx.accessToken, request.media.filePath));
      await request.checkpoint?.({ platformMediaId: mediaId });
      if (!await mediaReady(ctx.accessToken, mediaId)) return { success: true, state: "processing", platformMediaId: mediaId };
      const text = postText(request);
      await request.checkpoint?.({ committing: true });
      const response = await socialFetch(`${API}/tweets`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ctx.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          media: { media_ids: [mediaId] },
        }),
      });
      const json = (await response.json()) as {
        data?: { id?: string; text?: string };
        detail?: string;
        title?: string;
      };
      if (!response.ok || !json.data?.id) {
        if (response.status >= 400 && response.status < 500) await request.checkpoint?.({ committing: false });
        return {
          success: false,
          platformMediaId: mediaId,
          errorCode: "publish_failed",
          errorMessage: json.detail || json.title || "X post creation failed",
          needsReauth: response.status === 401,
        };
      }
      await request.checkpoint?.({ platformPostId: json.data.id, committing: false });
      const username =
        typeof ctx.accountMetadata?.username === "string"
          ? String(ctx.accountMetadata.username).replace(/^@/, "")
          : null;
      return {
        success: true,
        platformMediaId: mediaId,
        platformPostId: json.data.id,
        platformPostUrl: username
          ? `https://x.com/${username}/status/${json.data.id}`
          : `https://x.com/i/web/status/${json.data.id}`,
        rawSafeResponse: { id: json.data.id },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "X publish failed";
      return {
        success: false,
        errorCode: /unauthorized|401|expired/i.test(message)
          ? "needs_reauth"
          : "publish_failed",
        errorMessage: message,
        needsReauth: /unauthorized|401|expired/i.test(message),
      };
    }
  },

  async getPublishStatus(ctx, platformPostId): Promise<PublishStatus> {
    const response = await socialFetch(`${API}/tweets/${encodeURIComponent(platformPostId)}`, { headers: { Authorization: `Bearer ${ctx.accessToken}` } });
    const json = await response.json() as { data?: { id?: string } };
    if (!response.ok || !json.data?.id) return { state: "unknown", platformPostId };
    return {
      state: "published",
      platformPostId,
      platformPostUrl: `https://x.com/i/web/status/${platformPostId}`,
    };
  },
};
