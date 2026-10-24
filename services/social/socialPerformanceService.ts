import { randomUUID } from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { metricNumber as number, emptyPostMetrics, type PostMetrics, type PerformanceResult } from "@/lib/social/performance";
import type { PublisherContext } from "@/lib/social/SocialPublisher";
import { safePublishError } from "@/lib/social/publishingPolicy";
import { socialFetch } from "@/lib/social/http";
import { GRAPH } from "./publishers/metaOAuth";
import { instagramGraph } from "./publishers/instagramOAuth";
import { getPublisherContext } from "./socialConnectionService";

type Json = Record<string, unknown>;
const obj = (value: unknown): Json => value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
const list = (value: unknown): Json[] => Array.isArray(value) ? value.map(obj) : [];
const HOUR = 60 * 60 * 1000;
async function read(url: string, token: string, init?: RequestInit): Promise<Json> {
  const response = await socialFetch(url, { ...init, signal: AbortSignal.timeout(15_000), headers: { ...init?.headers, Authorization: `Bearer ${token}` } });
  const data = obj(await response.json());
  const error = obj(data.error);
  if (!response.ok || (error.code && error.code !== "ok")) throw new Error(response.status === 401 || response.status === 403 ? "This account needs analytics permission or renewed access. Reconnect it from Connected accounts." : `Platform statistics are unavailable (${response.status}). Try again later.`);
  return data;
}

/** Only requests statistics for the stored provider post ID, never an arbitrary URL. */
export async function fetchPostMetrics(platform: string, id: string, ctx: PublisherContext, postedAt: Date, scopes: string | null): Promise<PostMetrics> {
  if (!/^[\w-]{1,100}$/.test(id)) throw new Error("This upload doesn't have a published video ID yet.");
  const metrics = emptyPostMetrics(), token = ctx.accessToken;
  if (platform === "youtube") {
    const data = await read(`https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${encodeURIComponent(id)}`, token);
    const video = list(data.items).find((item) => item.id === id);
    if (!video) throw new Error("YouTube hasn't returned this video's statistics yet.");
    const stats = obj(video.statistics);
    metrics.views = number(stats.viewCount); metrics.likes = number(stats.likeCount); metrics.comments = number(stats.commentCount);
    if (scopes?.includes("yt-analytics.readonly")) {
      const params = new URLSearchParams({ ids: "channel==MINE", startDate: postedAt.toISOString().slice(0, 10), endDate: new Date().toISOString().slice(0, 10), metrics: "averageViewDuration,averageViewPercentage,shares", filters: `video==${id}` });
      try {
        const report = await read(`https://youtubeanalytics.googleapis.com/v2/reports?${params}`, token);
        const headers = list(report.columnHeaders).map((column) => column.name);
        const row = Array.isArray(report.rows) && Array.isArray(report.rows[0]) ? report.rows[0] as unknown[] : [];
        metrics.averageWatchSeconds = number(row[headers.indexOf("averageViewDuration")]);
        metrics.averageViewPercent = number(row[headers.indexOf("averageViewPercentage")]);
        metrics.shares = number(row[headers.indexOf("shares")]);
        if (!row.length) metrics.note = "YouTube watch-time reports can arrive later than view counts.";
      } catch { metrics.note = "Watch-time reporting needs the YouTube Analytics API enabled and authorized. Basic counts are available."; }
    } else metrics.note = "Reconnect with performance access to see average watch time and percentage viewed.";
    return metrics;
  }
  if (platform === "tiktok") {
    if (!scopes?.split(/[,\s]+/).includes("video.list")) throw new Error("Reconnect TikTok with performance access (video.list) to read video statistics.");
    const data = await read("https://open.tiktokapis.com/v2/video/query/?fields=id,view_count,like_count,comment_count,share_count", token,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filters: { video_ids: [id] } }) });
    const video = list(obj(data.data).videos).find((item) => String(item.id) === id);
    if (!video) throw new Error("TikTok hasn't returned a public video for this upload yet. Inbox drafts and private videos may not have queryable statistics.");
    metrics.views = number(video.view_count); metrics.likes = number(video.like_count); metrics.comments = number(video.comment_count); metrics.shares = number(video.share_count);
    metrics.note = "TikTok's publishing API does not provide audience retention."; return metrics;
  }
  if (platform === "x") {
    const recent = Date.now() - postedAt.getTime() < 29 * 86400000;
    const params = new URLSearchParams({ "tweet.fields": "public_metrics,attachments", expansions: "attachments.media_keys", "media.fields": recent ? "type,public_metrics,non_public_metrics" : "type,public_metrics" });
    let data: Json;
    try { data = await read(`https://api.x.com/2/tweets/${id}?${params}`, token); }
    catch { params.set("media.fields", "type,public_metrics"); data = await read(`https://api.x.com/2/tweets/${id}?${params}`, token); }
    if (!obj(data.data).id) throw new Error("X hasn't returned this post's statistics.");
    const stats = obj(obj(data.data).public_metrics);
    const keys = obj(obj(data.data).attachments).media_keys;
    const video = list(obj(data.includes).media).find((item) => item.type === "video" && Array.isArray(keys) && keys.includes(item.media_key));
    metrics.views = number(obj(video?.public_metrics).view_count);
    metrics.impressions = number(stats.impression_count); metrics.likes = number(stats.like_count); metrics.comments = number(stats.reply_count);
    metrics.shares = number(stats.retweet_count) === null ? null : Number(stats.retweet_count) + (number(stats.quote_count) || 0);
    const playback = obj(video?.non_public_metrics), starts = number(playback.playback_0_count), finishes = number(playback.playback_100_count);
    if (starts && finishes !== null) metrics.completionPercent = finishes / starts * 100;
    metrics.note = "X video views include other posts using the same media. Completion is available only for recent owned videos."; return metrics;
  }
  if (platform === "instagram") {
    const graph = instagramGraph(ctx.accountMetadata);
    const data = await read(`${graph}/${id}?fields=id,like_count,comments_count`, token);
    metrics.likes = number(data.like_count); metrics.comments = number(data.comments_count);
    // Insights access is optional; its absence must not erase available counts.
    try {
      const insights = await read(`${graph}/${id}/insights?metric=views,shares,saved`, token);
      for (const metric of list(insights.data)) {
        const value = number(list(metric.values)[0]?.value);
        if (metric.name === "views") metrics.views = value;
        if (metric.name === "shares") metrics.shares = value;
        if (metric.name === "saved") metrics.saves = value;
      }
    } catch { metrics.note = "Views and saves require Instagram insights permission. Available engagement counts are shown."; }
    return metrics;
  }
  if (platform === "facebook") {
    const data = await read(`${GRAPH}/${id}?fields=id,likes.limit(0).summary(true),comments.limit(0).summary(true),shares`, token);
    metrics.likes = number(obj(obj(data.likes).summary).total_count);
    metrics.comments = number(obj(obj(data.comments).summary).total_count); metrics.shares = number(obj(data.shares).count);
    metrics.note = "Facebook video views and retention require additional Page insights access."; return metrics;
  }
  throw new Error("This platform does not provide statistics in Clipper yet.");
}

export async function getPostPerformance(userId: string, ids: string[]): Promise<PerformanceResult[]> {
  if (!ids.length) return [];
  const jobs = await prisma.socialPublishJob.findMany({ where: { id: { in: ids }, publishGroup: { userId }, status: "completed" },
    select: { id: true, events: { where: { type: { in: ["performance_snapshot", "performance_check"] }, createdAt: { gte: new Date(Date.now() - 30 * 86400000) } }, orderBy: { createdAt: "desc" }, take: 24 } } });
  return jobs.map((job) => {
    const snapshot = job.events.find((event) => event.type === "performance_snapshot");
    const latest = obj(job.events[0]?.safeMetadata);
    return { id: job.id, metrics: snapshot ? obj(snapshot.safeMetadata).metrics as PostMetrics : null,
      refreshedAt: snapshot?.createdAt.toISOString() || null, error: typeof latest.error === "string" ? latest.error : null,
      history: job.events.filter((event) => event.type === "performance_snapshot").reverse().map((event) => ({ at: event.createdAt.toISOString(), views: number(obj(obj(event.safeMetadata).metrics).views) })) };
  });
}

async function refreshOne(userId: string, id: string) {
  const job = await prisma.socialPublishJob.findFirst({ where: { id, publishGroup: { userId }, status: "completed" },
    include: { connectedSocialAccount: { select: { grantedScopes: true, updatedAt: true } }, events: { where: { type: { in: ["performance_snapshot", "performance_check"] } }, orderBy: { createdAt: "desc" }, take: 1 } } });
  if (!job) throw new Error("Published post not found");
  const lastCheck = job.events[0];
  const reconnectedAfterError = lastCheck?.type === "performance_check" && job.connectedSocialAccount.updatedAt > lastCheck.createdAt;
  if (lastCheck && !reconnectedAfterError && Date.now() - lastCheck.createdAt.getTime() < HOUR) return;
  const lease = `metrics:${randomUUID()}`;
  const claimed = await prisma.socialPublishJob.updateMany({ where: { id, status: "completed", publishGroup: { userId },
    OR: [{ lockedBy: null }, { lockedAt: { lt: new Date(Date.now() - 120_000) } }] }, data: { lockedBy: lease, lockedAt: new Date() } });
  if (!claimed.count) return;
  try {
    let metadata: Prisma.InputJsonValue, type: string;
    try {
      if (!job.platformPostId) throw new Error("No published video ID is available yet.");
      const metrics = await fetchPostMetrics(job.platform, job.platformPostId, await getPublisherContext(job.connectedSocialAccountId), job.completedAt || job.createdAt, job.connectedSocialAccount.grantedScopes);
      metadata = { metrics } as unknown as Prisma.InputJsonValue; type = "performance_snapshot";
    } catch (error) { metadata = { error: safePublishError(error instanceof Error ? error.message : "Statistics unavailable") }; type = "performance_check"; }
    await prisma.socialPublishEvent.create({ data: { publishJobId: id, type, message: type === "performance_snapshot" ? "Statistics refreshed" : "Statistics unavailable", safeMetadata: metadata } });
    await prisma.socialPublishEvent.deleteMany({ where: { publishJobId: id, type: { in: ["performance_snapshot", "performance_check"] }, createdAt: { lt: new Date(Date.now() - 30 * 86400000) } } });
  } finally { await prisma.socialPublishJob.updateMany({ where: { id, lockedBy: lease }, data: { lockedBy: null, lockedAt: null } }); }
}

export async function refreshPostPerformance(userId: string, ids: string[]) {
  for (let offset = 0; offset < ids.length; offset += 4) await Promise.allSettled(ids.slice(offset, offset + 4).map((id) => refreshOne(userId, id)));
  return getPostPerformance(userId, ids);
}
