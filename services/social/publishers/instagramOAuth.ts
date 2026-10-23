import { socialFetch } from "@/lib/social/http";
import { publicOrigin } from "@/lib/social/oauth";
import { GRAPH } from "./metaOAuth";

// This marker binds the callback to the route selected before authorization.
// Older Instagram states have no marker and continue using Facebook Login.
export const INSTAGRAM_LOGIN_STATE = "instagram_login";
export const INSTAGRAM_SCOPES = ["instagram_business_basic", "instagram_business_content_publish"];
const version = GRAPH.split("/").at(-1)!;
export const INSTAGRAM_GRAPH = `https://graph.instagram.com/${version}`;

export function instagramOAuthConfigured(): boolean {
  return Boolean(process.env.INSTAGRAM_CLIENT_ID?.trim() && process.env.INSTAGRAM_CLIENT_SECRET?.trim());
}

export function instagramGraph(metadata: Record<string, unknown> | null | undefined): string {
  return metadata?.authType === INSTAGRAM_LOGIN_STATE ? INSTAGRAM_GRAPH : GRAPH;
}

function redirectUri(): string {
  return process.env.INSTAGRAM_REDIRECT_URI?.trim() || `${publicOrigin()}/api/social/oauth/instagram/callback`;
}

export function buildInstagramAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.INSTAGRAM_CLIENT_ID!.trim(),
    redirect_uri: redirectUri(), response_type: "code",
    scope: INSTAGRAM_SCOPES.join(","), state,
  });
  return `https://www.instagram.com/oauth/authorize?${params}`;
}

type Grant = { access_token?: string; user_id?: string | number; permissions?: string | string[] };
type GraphError = { error?: { message?: string }; error_message?: string };

// Meta documents wrapped responses; some versions also return a flat object.
// Reject ambiguous grants rather than binding a token to the wrong account.
function singleResult<T>(json: T & { data?: T[] }): T {
  if (!json.data) return json;
  if (!Array.isArray(json.data) || json.data.length !== 1) throw new Error("Instagram returned an ambiguous account. Reconnect and try again.");
  return json.data[0];
}

function tokenResult(json: { access_token?: string; expires_in?: number } & GraphError, ok: boolean) {
  if (!ok || !json.access_token || !Number.isFinite(json.expires_in) || json.expires_in! <= 0) {
    throw new Error(json.error?.message || json.error_message || "Could not renew the Instagram connection. Reconnect your account.");
  }
  return { accessToken: json.access_token, expiresAt: new Date(Date.now() + json.expires_in! * 1000) };
}

export async function exchangeInstagramCode(code: string) {
  const body = new FormData();
  body.set("client_id", process.env.INSTAGRAM_CLIENT_ID!.trim());
  body.set("client_secret", process.env.INSTAGRAM_CLIENT_SECRET!.trim());
  body.set("grant_type", "authorization_code");
  body.set("redirect_uri", redirectUri());
  body.set("code", code);
  const response = await socialFetch("https://api.instagram.com/oauth/access_token", { method: "POST", body });
  const json = await response.json() as Grant & GraphError & { data?: Grant[] };
  if (!response.ok || json.error || json.error_message) throw new Error(json.error?.message || json.error_message || "Instagram token exchange failed");
  if (json.data && json.access_token) throw new Error("Instagram returned an ambiguous authorization. Reconnect and try again.");
  const grant = singleResult<Grant>(json);
  if (!grant.access_token) throw new Error("Instagram did not return an access token");
  const scopes = Array.isArray(grant.permissions) ? grant.permissions : (grant.permissions || "").split(/[,\s]+/);
  if (grant.permissions !== undefined && INSTAGRAM_SCOPES.some((scope) => !scopes.includes(scope))) {
    throw new Error("Instagram publishing permission was not granted. Reconnect and allow content publishing.");
  }
  const params = new URLSearchParams({ grant_type: "ig_exchange_token", client_secret: process.env.INSTAGRAM_CLIENT_SECRET!.trim(), access_token: grant.access_token });
  const longResponse = await socialFetch(`https://graph.instagram.com/access_token?${params}`);
  const longJson = await longResponse.json();
  return { ...tokenResult(longJson, longResponse.ok), scope: scopes.filter(Boolean).join(" ") || null };
}

export async function refreshInstagramAccessToken(accessToken: string) {
  const params = new URLSearchParams({ grant_type: "ig_refresh_token", access_token: accessToken });
  const response = await socialFetch(`https://graph.instagram.com/refresh_access_token?${params}`);
  return tokenResult(await response.json(), response.ok);
}

export async function fetchDirectInstagramProfile(accessToken: string) {
  const response = await socialFetch(`${INSTAGRAM_GRAPH}/me?fields=user_id,username,name,profile_picture_url,account_type`, { headers: { Authorization: `Bearer ${accessToken}` } });
  type Profile = { user_id?: string | number; username?: string; name?: string; profile_picture_url?: string; account_type?: string };
  const json = await response.json() as Profile & GraphError & { data?: Profile[] };
  if (!response.ok || json.error) throw new Error(json.error?.message || "Could not load Instagram professional account");
  const profile = singleResult<Profile>(json);
  if (!profile.user_id || !profile.username) throw new Error("Instagram did not return a professional account. Use a Business or Creator account.");
  return { id: String(profile.user_id), username: profile.username, name: profile.name || profile.username, profilePictureUrl: profile.profile_picture_url || null };
}
