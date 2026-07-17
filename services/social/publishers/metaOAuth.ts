import { createMediaGrant, createPkcePair, publicOrigin } from "@/lib/social/oauth";

const GRAPH = "https://graph.facebook.com/v21.0";
const AUTH = "https://www.facebook.com/v21.0/dialog/oauth";
const TOKEN = "https://graph.facebook.com/v21.0/oauth/access_token";

const META_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "pages_manage_engagement",
  "instagram_basic",
  "instagram_content_publish",
  "business_management",
].join(",");

export function metaOAuthConfigured(): boolean {
  return Boolean(
    process.env.META_APP_ID?.trim() && process.env.META_APP_SECRET?.trim()
  );
}

export function getMetaRedirectUri(platform: "facebook" | "instagram"): string {
  const specific =
    platform === "instagram"
      ? process.env.INSTAGRAM_REDIRECT_URI?.trim()
      : process.env.FACEBOOK_REDIRECT_URI?.trim();
  return (
    specific ||
    process.env.META_REDIRECT_URI?.trim() ||
    `${publicOrigin()}/api/social/oauth/${platform}/callback`
  );
}

export { createPkcePair };

export function buildMetaAuthUrl(options: {
  state: string;
  platform: "facebook" | "instagram";
}): string {
  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID!.trim(),
    redirect_uri: getMetaRedirectUri(options.platform),
    state: options.state,
    response_type: "code",
    scope: META_SCOPES,
  });
  return `${AUTH}?${params.toString()}`;
}

export async function exchangeMetaCode(options: {
  code: string;
  platform: "facebook" | "instagram";
}): Promise<{
  accessToken: string;
  expiresAt: Date | null;
}> {
  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID!.trim(),
    client_secret: process.env.META_APP_SECRET!.trim(),
    redirect_uri: getMetaRedirectUri(options.platform),
    code: options.code,
  });
  const response = await fetch(`${TOKEN}?${params.toString()}`);
  const json = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: { message?: string };
  };
  if (!response.ok || !json.access_token) {
    throw new Error(json.error?.message || "Meta token exchange failed");
  }

  // Exchange for long-lived user token
  const longParams = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: process.env.META_APP_ID!.trim(),
    client_secret: process.env.META_APP_SECRET!.trim(),
    fb_exchange_token: json.access_token,
  });
  const longRes = await fetch(`${TOKEN}?${longParams.toString()}`);
  const longJson = (await longRes.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  const accessToken = longJson.access_token || json.access_token;
  const expiresIn = longJson.expires_in || json.expires_in;
  return {
    accessToken,
    expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
  };
}

export interface MetaPage {
  id: string;
  name: string;
  access_token: string;
  instagram_business_account?: { id: string };
}

export async function fetchMetaPages(userAccessToken: string): Promise<MetaPage[]> {
  const url = `${GRAPH}/me/accounts?fields=id,name,access_token,instagram_business_account&limit=100&access_token=${encodeURIComponent(userAccessToken)}`;
  const response = await fetch(url);
  const json = (await response.json()) as {
    data?: MetaPage[];
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(json.error?.message || "Could not load Facebook Pages");
  }
  return json.data || [];
}

export async function fetchInstagramProfile(
  igUserId: string,
  pageAccessToken: string
): Promise<{
  id: string;
  username: string | null;
  name: string | null;
  profilePictureUrl: string | null;
}> {
  const url = `${GRAPH}/${igUserId}?fields=id,username,name,profile_picture_url&access_token=${encodeURIComponent(pageAccessToken)}`;
  const response = await fetch(url);
  const json = (await response.json()) as {
    id?: string;
    username?: string;
    name?: string;
    profile_picture_url?: string;
    error?: { message?: string };
  };
  if (!response.ok || !json.id) {
    throw new Error(json.error?.message || "Could not load Instagram account");
  }
  return {
    id: json.id,
    username: json.username || null,
    name: json.name || null,
    profilePictureUrl: json.profile_picture_url || null,
  };
}

export async function fetchFacebookUser(accessToken: string): Promise<{
  id: string;
  name: string;
}> {
  const response = await fetch(
    `${GRAPH}/me?fields=id,name&access_token=${encodeURIComponent(accessToken)}`
  );
  const json = (await response.json()) as {
    id?: string;
    name?: string;
    error?: { message?: string };
  };
  if (!response.ok || !json.id) {
    throw new Error(json.error?.message || "Could not load Facebook user");
  }
  return { id: json.id, name: json.name || "Facebook user" };
}

export function buildPublicVideoUrl(filePath: string): string {
  const { token } = createMediaGrant({ filePath, expiresInSeconds: 2 * 60 * 60 });
  return `${publicOrigin()}/api/social/media-grants/${token}`;
}

export { GRAPH };
