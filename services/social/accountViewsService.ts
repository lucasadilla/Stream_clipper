import type { PublisherContext } from "@/lib/social/SocialPublisher";
import { socialFetch } from "@/lib/social/http";
import { safeViewCount } from "@/lib/publicLanding";
import { GRAPH } from "./publishers/metaOAuth";
import { instagramGraph } from "./publishers/instagramOAuth";

type Json = Record<string, unknown>;
const obj = (value: unknown): Json => value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
const list = (value: unknown): Json[] => Array.isArray(value) ? value.map(obj) : [];
export interface AccountViewScan { cursor: string | null; total: string; seen: string[]; pages: number; items: number }
export interface AccountViewsPage { views: bigint; cursor: string | null; seen: string[]; items: number }
export function emptyAccountViewScan(): AccountViewScan { return { cursor: null, total: "0", seen: [], pages: 0, items: 0 }; }
export function parseAccountViewScan(value: unknown): AccountViewScan {
  const data = obj(value);
  return { cursor: typeof data.cursor === "string" ? data.cursor : null, total: typeof data.total === "string" && /^\d+$/.test(data.total) ? data.total : "0",
    seen: Array.isArray(data.seen) ? data.seen.filter((id): id is string => typeof id === "string") : [], pages: Number(data.pages) || 0, items: Number(data.items) || 0 };
}
async function read(url: string, ctx: PublisherContext, init?: RequestInit): Promise<Json> {
  const response = await socialFetch(url, { ...init, signal: AbortSignal.timeout(15_000), headers: { ...init?.headers, Authorization: `Bearer ${ctx.accessToken}` } });
  const body = obj(await response.json()), error = obj(body.error);
  if (!response.ok || (error.code && error.code !== "ok") || (Array.isArray(body.errors) && body.errors.length)) throw new Error("Account view statistics are unavailable. Renew analytics access and retry.");
  return body;
}
function count(value: unknown): bigint {
  const result = safeViewCount(value);
  if (result === null) throw new Error("The platform did not return a view count.");
  return result;
}
function nextCursor(body: Json): string | null {
  const paging = obj(body.paging);
  if (!paging.next) return null;
  const after = obj(paging.cursors).after;
  if (typeof after !== "string" || !after) throw new Error("Incomplete account pagination.");
  return after;
}

/** One bounded page. The caller publishes a total only after the entire account is read. */
export async function fetchAccountViewsPage(account: { platform: string; platformAccountId: string; grantedScopes: string | null }, ctx: PublisherContext, scan: AccountViewScan): Promise<AccountViewsPage> {
  const { platform, platformAccountId: id, grantedScopes: scopes } = account;
  if (!/^[\w-]{1,100}$/.test(id)) throw new Error("Invalid connected account ID.");
  const seen = new Set(scan.seen);
  let views = BigInt(0), items = 0, cursor: string | null = null;
  if (platform === "youtube") {
    const body = await read(`https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${encodeURIComponent(id)}`, ctx);
    const channel = list(body.items).find(row => row.id === id);
    return { views: count(obj(channel?.statistics).viewCount), cursor: null, seen: [], items: 1 };
  }
  if (platform === "tiktok") {
    if (!scopes?.split(/[,\s]+/).includes("video.list")) throw new Error("TikTok video.list permission is required.");
    const body = await read("https://open.tiktokapis.com/v2/video/list/?fields=id,view_count", ctx, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ max_count: 20, ...(scan.cursor ? { cursor: Number(scan.cursor) } : {}) }) });
    const data = obj(body.data);
    if (!Array.isArray(data.videos) || typeof data.has_more !== "boolean") throw new Error("Incomplete account video list.");
    for (const video of list(data.videos)) {
      if (typeof video.id !== "string") throw new Error("Incomplete account video list.");
      if (!seen.has(video.id)) { views += count(video.view_count); seen.add(video.id); items++; }
    }
    cursor = data.has_more === true ? String(data.cursor ?? "") : null;
    if (data.has_more === true && (!cursor || !/^\d+$/.test(cursor))) throw new Error("Incomplete account pagination.");
  } else if (platform === "instagram" || platform === "facebook") {
    const direct = ctx.accountMetadata?.authType === "instagram_login";
    const required = platform === "facebook" ? "read_insights" : direct ? "instagram_business_manage_insights" : "instagram_manage_insights";
    if (!scopes?.split(/[,\s]+/).includes(required)) throw new Error("Reconnect this account with insights access.");
    const graph = platform === "instagram" ? instagramGraph(ctx.accountMetadata) : GRAPH;
    const params = new URLSearchParams({ fields: "id", limit: "5", ...(scan.cursor ? { after: scan.cursor } : {}) });
    const body = await read(`${graph}/${id}/${platform === "instagram" ? "media" : "videos"}?${params}`, ctx);
    if (!Array.isArray(body.data) || list(body.data).some(row => typeof row.id !== "string")) throw new Error("Incomplete account video list.");
    const media = list(body.data).filter(row => typeof row.id === "string" && !seen.has(String(row.id)));
    // Read two insight records at a time; never count a failed/missing record as zero.
    for (let offset = 0; offset < media.length; offset += 2) {
      const counts = await Promise.all(media.slice(offset, offset + 2).map(async row => {
        const metric = platform === "instagram" ? "views" : "total_video_views";
        const result = await read(`${graph}/${encodeURIComponent(String(row.id))}/${platform === "instagram" ? "insights" : "video_insights"}?metric=${metric}`, ctx);
        const insight = list(result.data).find(entry => entry.name === metric);
        return count(list(insight?.values)[0]?.value ?? obj(insight?.total_value).value);
      }));
      views += counts.reduce((total, value) => total + value, BigInt(0));
    }
    media.forEach(row => seen.add(String(row.id))); items = media.length; cursor = nextCursor(body);
  } else if (platform === "x") {
    const params = new URLSearchParams({ max_results: "100", "tweet.fields": "attachments,author_id", expansions: "attachments.media_keys", "media.fields": "type,public_metrics", ...(scan.cursor ? { pagination_token: scan.cursor } : {}) });
    const body = await read(`https://api.x.com/2/users/${id}/tweets?${params}`, ctx);
    if (!Array.isArray(body.data) && obj(body.meta).result_count !== 0) throw new Error("Incomplete account post history.");
    for (const media of list(obj(body.includes).media)) {
      if (media.type !== "video" || typeof media.media_key !== "string" || seen.has(media.media_key)) continue;
      views += count(obj(media.public_metrics).view_count); seen.add(media.media_key);
    }
    items = list(body.data).length;
    cursor = typeof obj(body.meta).next_token === "string" ? String(obj(body.meta).next_token) : null;
    if (!cursor) {
      const profile = await read(`https://api.x.com/2/users/${id}?user.fields=public_metrics`, ctx);
      const posts = safeViewCount(obj(obj(profile.data).public_metrics).tweet_count);
      if (posts === null || posts > BigInt(scan.items + items)) throw new Error("X did not return the complete account history.");
    }
  } else throw new Error("This platform does not expose account view statistics yet.");
  if (cursor && cursor === scan.cursor) throw new Error("Account pagination did not advance.");
  return { views, cursor, seen: [...seen], items };
}
