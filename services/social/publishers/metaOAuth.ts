import { socialFetch } from "@/lib/social/http";
import { createMediaGrant, createPkcePair, publicOrigin } from "@/lib/social/oauth";

const configuredVersion = process.env.META_GRAPH_API_VERSION?.trim() || "v21.0";
const VERSION = /^v\d+\.\d+$/.test(configuredVersion) ? configuredVersion : "v21.0";
const GRAPH = `https://graph.facebook.com/${VERSION}`;
const AUTH = `https://www.facebook.com/${VERSION}/dialog/oauth`;
const TOKEN = `${GRAPH}/oauth/access_token`;

const META_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "instagram_basic",
  "instagram_content_publish",
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
  const configId = process.env.META_LOGIN_CONFIG_ID?.trim();
  if (configId) { params.set("config_id", configId); params.delete("scope"); }
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
  const response = await socialFetch(`${TOKEN}?${params.toString()}`);
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
  const longRes = await socialFetch(`${TOKEN}?${longParams.toString()}`);
  const longJson = (await longRes.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  // A rejected extension must not lend its expiry to the original short token.
  // Conversely, a successful extension without an expiry must not inherit the
  // short token's expiry and incorrectly ask the creator to reconnect early.
  const extended = longRes.ok && Boolean(longJson.access_token);
  const accessToken = extended ? longJson.access_token! : json.access_token;
  const expiresIn = extended ? longJson.expires_in : json.expires_in;
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
  const pages = new Map<string, MetaPage>();
  const cursors = new Set<string>();
  const url = new URL(`${GRAPH}/me/accounts`);
  url.searchParams.set("fields", "id,name,access_token,instagram_business_account");
  url.searchParams.set("limit", "100");
  // Keep credentials out of paging URLs and never follow arbitrary next URLs.
  const headers = { Authorization: `Bearer ${userAccessToken}` };
  for (let page = 0; page < 100; page += 1) {
    const response = await socialFetch(url.toString(), { headers });
    const json = (await response.json()) as {
      data?: MetaPage[];
      paging?: { next?: string; cursors?: { after?: string } };
      error?: { message?: string };
    };
    if (!response.ok || json.error || !Array.isArray(json.data)) {
      throw new Error(json.error?.message || "Could not load Facebook Pages");
    }
    for (const account of json.data) pages.set(account.id, account);
    if (!json.paging?.next) return [...pages.values()];
    const after = json.paging.cursors?.after;
    if (!after || cursors.has(after)) {
      throw new Error("Facebook returned incomplete Page results. Reconnect and try again.");
    }
    cursors.add(after);
    url.searchParams.set("after", after);
  }
  throw new Error("Facebook Page discovery is taking too long. Reconnect and try again.");
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
  const response = await socialFetch(url);
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
  const response = await socialFetch(
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
