import { createHash, randomBytes } from "crypto";
import { existsSync } from "fs";
import { readFile, stat } from "fs/promises";
import {
  canConnectPlatform,
  forcesPrivateUploads,
  getPlatformCapability,
} from "@/lib/social/capabilities";
import { getPublicSiteUrl } from "@/lib/publicOrigin";
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

const YT_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const YT_TOKEN = "https://oauth2.googleapis.com/token";
const YT_API = "https://www.googleapis.com/youtube/v3";
const YT_UPLOAD = "https://www.googleapis.com/upload/youtube/v3/videos";

const SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
].join(" ");

export function youtubeOAuthConfigured(): boolean {
  return Boolean(
    process.env.YOUTUBE_CLIENT_ID?.trim() &&
      process.env.YOUTUBE_CLIENT_SECRET?.trim()
  );
}

export function getYouTubeRedirectUri(): string {
  return (
    process.env.YOUTUBE_REDIRECT_URI?.trim() ||
    `${getPublicSiteUrl()}/api/social/oauth/youtube/callback`
  );
}

export function buildYouTubeAuthUrl(options: {
  state: string;
  codeChallenge: string;
}): string {
  const params = new URLSearchParams({
    client_id: process.env.YOUTUBE_CLIENT_ID!.trim(),
    redirect_uri: getYouTubeRedirectUri(),
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
    state: options.state,
    code_challenge: options.codeChallenge,
    code_challenge_method: "S256",
  });
  return `${YT_AUTH}?${params.toString()}`;
}

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export async function exchangeYouTubeCode(options: {
  code: string;
  codeVerifier: string;
}): Promise<{
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  scope: string | null;
}> {
  const body = new URLSearchParams({
    client_id: process.env.YOUTUBE_CLIENT_ID!.trim(),
    client_secret: process.env.YOUTUBE_CLIENT_SECRET!.trim(),
    code: options.code,
    code_verifier: options.codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: getYouTubeRedirectUri(),
  });

  const response = await fetch(YT_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
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
    throw new Error(json.error_description || json.error || "YouTube token exchange failed");
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

export async function refreshYouTubeAccessToken(refreshToken: string): Promise<{
  accessToken: string;
  expiresAt: Date | null;
  scope: string | null;
}> {
  const body = new URLSearchParams({
    client_id: process.env.YOUTUBE_CLIENT_ID!.trim(),
    client_secret: process.env.YOUTUBE_CLIENT_SECRET!.trim(),
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const response = await fetch(YT_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !json.access_token) {
    throw new Error(json.error_description || json.error || "YouTube token refresh failed");
  }
  return {
    accessToken: json.access_token,
    expiresAt: json.expires_in
      ? new Date(Date.now() + json.expires_in * 1000)
      : null,
    scope: json.scope ?? null,
  };
}

export async function fetchYouTubeChannel(accessToken: string): Promise<{
  platformAccountId: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  metadata: Record<string, unknown>;
}> {
  const url = `${YT_API}/channels?part=snippet,contentDetails,status&mine=true`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = (await response.json()) as {
    items?: Array<{
      id: string;
      snippet?: {
        title?: string;
        customUrl?: string;
        thumbnails?: { default?: { url?: string } };
      };
    }>;
    error?: { message?: string };
  };
  if (!response.ok || !json.items?.[0]) {
    throw new Error(json.error?.message || "Could not load YouTube channel");
  }
  const channel = json.items[0];
  return {
    platformAccountId: channel.id,
    displayName: channel.snippet?.title || "YouTube channel",
    username: channel.snippet?.customUrl || null,
    avatarUrl: channel.snippet?.thumbnails?.default?.url || null,
    metadata: { channelId: channel.id },
  };
}

async function ytFetch(
  accessToken: string,
  url: string,
  init?: RequestInit
): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers || {}),
    },
  });
}

function resolvePrivacy(
  settings: PublishRequest["settings"]
): "private" | "unlisted" | "public" {
  if (forcesPrivateUploads("youtube")) return "private";
  const privacy = settings.privacy;
  if (privacy === "public" || privacy === "unlisted" || privacy === "private") {
    return privacy;
  }
  return "private";
}

function buildSnippet(request: PublishRequest) {
  const content = request.content;
  const title = (content.title || "Untitled clip").slice(0, 100);
  const descriptionParts = [
    content.description || content.caption || content.postText,
    content.hashtags.length ? content.hashtags.join(" ") : "",
  ].filter(Boolean);
  return {
    title,
    description: descriptionParts.join("\n\n").slice(0, 5000),
    tags: content.tags.slice(0, 15),
    categoryId: String(request.settings.categoryId || "22"),
  };
}

async function initResumableUpload(
  accessToken: string,
  request: PublishRequest,
  fileSize: number
): Promise<string> {
  const privacy = resolvePrivacy(request.settings);
  const snippet = buildSnippet(request);
  const status: Record<string, unknown> = {
    privacyStatus: privacy,
    selfDeclaredMadeForKids: Boolean(request.settings.madeForKids),
    embeddable: true,
    publicStatsViewable: true,
  };
  if (request.settings.scheduledFor && privacy !== "public") {
    // YouTube schedules via publishAt only when privacy is private
    status.publishAt = new Date(request.settings.scheduledFor).toISOString();
    status.privacyStatus = "private";
  }
  if (request.settings.notifySubscribers === false) {
    status.license = "youtube";
  }

  const meta = {
    snippet,
    status,
  };

  const response = await ytFetch(
    accessToken,
    `${YT_UPLOAD}?uploadType=resumable&part=snippet,status`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Length": String(fileSize),
        "X-Upload-Content-Type": "video/mp4",
      },
      body: JSON.stringify(meta),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`YouTube upload init failed: ${err.slice(0, 400)}`);
  }
  const location = response.headers.get("location");
  if (!location) throw new Error("YouTube did not return a resumable upload URL");
  return location;
}

async function uploadVideoBytes(
  uploadUrl: string,
  accessToken: string,
  filePath: string,
  fileSize: number
): Promise<{ id: string; status?: { privacyStatus?: string; uploadStatus?: string } }> {
  const bytes = await readFile(filePath);
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "video/mp4",
      "Content-Length": String(fileSize),
    },
    body: bytes,
  });
  const json = (await response.json()) as {
    id?: string;
    status?: { privacyStatus?: string; uploadStatus?: string };
    error?: { message?: string };
  };
  if (!response.ok || !json.id) {
    throw new Error(json.error?.message || `YouTube upload failed (${response.status})`);
  }
  return { id: json.id, status: json.status };
}

async function pollProcessing(
  accessToken: string,
  videoId: string,
  maxAttempts = 40
): Promise<PublishStatus> {
  for (let i = 0; i < maxAttempts; i++) {
    const response = await ytFetch(
      accessToken,
      `${YT_API}/videos?part=status,processingDetails&id=${encodeURIComponent(videoId)}`
    );
    const json = (await response.json()) as {
      items?: Array<{
        status?: { uploadStatus?: string; privacyStatus?: string; rejectionReason?: string };
        processingDetails?: { processingStatus?: string };
      }>;
    };
    const item = json.items?.[0];
    const uploadStatus = item?.status?.uploadStatus;
    const processingStatus = item?.processingDetails?.processingStatus;
    if (uploadStatus === "rejected") {
      return {
        state: "failed",
        platformPostId: videoId,
        errorMessage: item?.status?.rejectionReason || "YouTube rejected the upload",
      };
    }
    if (uploadStatus === "processed" || processingStatus === "succeeded") {
      return {
        state: "published",
        platformPostId: videoId,
        platformPostUrl: `https://youtu.be/${videoId}`,
        privacyStatus: item?.status?.privacyStatus,
      };
    }
    if (uploadStatus === "failed") {
      return {
        state: "failed",
        platformPostId: videoId,
        errorMessage: "YouTube processing failed",
      };
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  // Upload accepted; processing may continue — treat as published with URL
  return {
    state: "published",
    platformPostId: videoId,
    platformPostUrl: `https://youtu.be/${videoId}`,
  };
}

export const youtubePublisher: SocialPublisher = {
  platform: "youtube",

  async validateConnection(ctx: PublisherContext) {
    if (!canConnectPlatform("youtube") || !youtubeOAuthConfigured()) {
      return { ok: false, error: "YouTube publishing is not configured" };
    }
    try {
      const channel = await fetchYouTubeChannel(ctx.accessToken);
      return {
        ok: true,
        displayName: channel.displayName,
        username: channel.username ?? undefined,
        avatarUrl: channel.avatarUrl ?? undefined,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Validation failed";
      const needsReauth =
        /invalid|expired|revoked|unauthorized|401/i.test(message);
      return { ok: false, error: message, needsReauth };
    }
  },

  async getDestinations(ctx: PublisherContext): Promise<SocialDestination[]> {
    const channel = await fetchYouTubeChannel(ctx.accessToken);
    return [
      {
        id: channel.platformAccountId,
        label: channel.displayName,
        kind: "channel",
        metadata: channel.metadata,
      },
    ];
  },

  async validatePost(
    _ctx: PublisherContext,
    request: PublishRequest
  ): Promise<SocialValidationResult> {
    const warnings: SocialValidationResult["warnings"] = [];
    if (!existsSync(request.media.filePath)) {
      warnings.push({
        code: "missing_file",
        message: "Video file is missing on disk.",
        severity: "error",
      });
    }
    if (!request.content.title.trim()) {
      warnings.push({
        code: "missing_title",
        message: "YouTube requires a title.",
        severity: "error",
      });
    }
    if (request.content.title.length > 100) {
      warnings.push({
        code: "title_too_long",
        message: "Title exceeds 100 characters.",
        severity: "error",
      });
    }
    if (forcesPrivateUploads("youtube") && request.settings.privacy === "public") {
      warnings.push({
        code: "private_only",
        message:
          "This YouTube API project currently restricts uploads to private. The post will be published as private.",
        severity: "warning",
      });
    }
    const capability = getPlatformCapability("youtube");
    if (capability === "not_configured") {
      warnings.push({
        code: "not_configured",
        message: "YouTube publishing is not configured.",
        severity: "error",
      });
    }
    return {
      ok: !warnings.some((w) => w.severity === "error"),
      warnings,
    };
  },

  async publish(ctx: PublisherContext, request: PublishRequest): Promise<PublishResult> {
    if (!existsSync(request.media.filePath)) {
      return {
        success: false,
        errorCode: "missing_file",
        errorMessage: "Video file is missing on disk",
      };
    }

    try {
      const fileStat = await stat(request.media.filePath);
      let uploadUrl = request.existingUploadId || null;
      if (!uploadUrl) {
        uploadUrl = await initResumableUpload(
          ctx.accessToken,
          request,
          fileStat.size
        );
      }

      const uploaded = await uploadVideoBytes(
        uploadUrl,
        ctx.accessToken,
        request.media.filePath,
        fileStat.size
      );

      const status = await pollProcessing(ctx.accessToken, uploaded.id);
      if (status.state === "failed") {
        return {
          success: false,
          platformPostId: uploaded.id,
          platformUploadId: uploadUrl,
          errorCode: "processing_failed",
          errorMessage: status.errorMessage || "YouTube processing failed",
          rawSafeResponse: { privacyStatus: uploaded.status?.privacyStatus },
        };
      }

      const privacy = resolvePrivacy(request.settings);
      return {
        success: true,
        platformPostId: uploaded.id,
        platformUploadId: uploadUrl,
        platformPostUrl: status.platformPostUrl || `https://youtu.be/${uploaded.id}`,
        privacyStatus: status.privacyStatus || privacy,
        rawSafeResponse: {
          privacyStatus: status.privacyStatus || privacy,
          forcedPrivate: forcesPrivateUploads("youtube"),
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "YouTube publish failed";
      const needsReauth = /invalid|expired|revoked|unauthorized|401/i.test(message);
      return {
        success: false,
        errorCode: needsReauth ? "needs_reauth" : "publish_failed",
        errorMessage: message,
        needsReauth,
      };
    }
  },

  async getPublishStatus(ctx: PublisherContext, platformPostId: string) {
    return pollProcessing(ctx.accessToken, platformPostId, 1);
  },
};
