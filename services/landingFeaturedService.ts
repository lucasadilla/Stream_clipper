import { randomUUID } from "crypto";
import { prisma } from "@/lib/db";
import { fallbackShorts, HERO_CHANNEL_ID, HERO_SHORTS, VERIFIED_COMPARISON_SOURCE, selectFeaturedShorts, type FeaturedShort } from "@/lib/heroShorts";
import { safeViewCount } from "@/lib/publicLanding";
import { parseIso8601Duration } from "@/lib/time";
import { socialFetch } from "@/lib/social/http";
import { getPublisherContext } from "@/services/social/socialConnectionService";

const ID = "hero-shorts";
type Video = {
  id: string;
  snippet: { channelId: string; title: string; description?: string; tags?: string[]; publishedAt: string };
  contentDetails: { duration: string };
  statistics?: { viewCount?: string };
  status: { privacyStatus: string; embeddable: boolean };
};

export async function getFeaturedShorts(): Promise<FeaturedShort[]> {
  try {
    const rows = await prisma.landingFeaturedVideo.findMany({ where: { available: true } });
    const selected = selectFeaturedShorts(rows);
    if (!selected.length) {
      // After a successful refresh, deleted/private clips must not reappear as static fallbacks.
      const refreshed = await prisma.landingFeatureRefresh.findUnique({ where: { id: ID } });
      return refreshed?.refreshedAt ? [] : fallbackShorts();
    }
    return selected.map(row => ({ id: row.id, title: row.title, poster: row.poster,
      views: row.views?.toString() ?? null, refreshedAt: row.refreshedAt.toISOString(), durationSeconds: row.durationSeconds,
      source: row.sourceVideoId && row.sourceStartSeconds !== null && row.sourceEndSeconds !== null ? {
        videoId: row.sourceVideoId, startSeconds: row.sourceStartSeconds, endSeconds: row.sourceEndSeconds,
      } : null }));
  } catch { return fallbackShorts(); }
}

/** Public YouTube data only, using the existing API key or existing read-only authorization. */
async function youtubeReader() {
  const key = process.env.YOUTUBE_API_KEY?.trim();
  let accessToken: string | undefined;
  if (!key) {
    const account = await prisma.connectedSocialAccount.findFirst({ where: { platform: "youtube", isActive: true }, orderBy: { updatedAt: "desc" }, select: { id: true } });
    if (!account) throw new Error("YouTube metadata access is not configured.");
    accessToken = (await getPublisherContext(account.id)).accessToken;
  }
  return async <T>(path: string, params: Record<string, string>): Promise<T> => {
    const search = new URLSearchParams({ ...params, ...(key ? { key } : {}) });
    const response = await socialFetch(`https://www.googleapis.com/youtube/v3/${path}?${search}`, {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {}, signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("YouTube channel metadata is temporarily unavailable.");
    return response.json() as Promise<T>;
  };
}

export function publicShortCandidate(video: Video, confirmedIds: Set<string>): boolean {
  const duration = parseIso8601Duration(video.contentDetails.duration);
  return video.snippet.channelId === HERO_CHANNEL_ID && video.status.privacyStatus === "public" && video.status.embeddable === true
    && duration > 0 && duration <= 180 && (confirmedIds.has(video.id)
      || /(?:^|\s)#shorts\b/i.test(`${video.snippet.title} ${video.snippet.description ?? ""}`)
      || video.snippet.tags?.some(tag => /^#?shorts$/i.test(tag)) === true);
}

/** Once daily, bounded to the latest 50 uploads plus the saved catalog. Never runs on page visits. */
export async function refreshFeaturedShorts(now = new Date()): Promise<boolean> {
  await prisma.landingFeatureRefresh.upsert({ where: { id: ID }, create: { id: ID }, update: {} });
  const lease = randomUUID();
  const claimed = await prisma.landingFeatureRefresh.updateMany({ where: { id: ID,
    AND: [ { OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
      { OR: [{ refreshedAt: null }, { refreshedAt: { lt: new Date(now.getTime() - 86_400_000) } }] },
      { OR: [{ attemptedAt: null }, { attemptedAt: { lt: new Date(now.getTime() - 3_600_000) } }] } ],
  }, data: { lockedBy: lease, lockedUntil: new Date(now.getTime() + 300_000), attemptedAt: now } });
  if (!claimed.count) return false;
  try {
    const read = await youtubeReader();
    const channel = await read<{ items: Array<{ contentDetails: { relatedPlaylists: { uploads: string } } }> }>("channels", { id: HERO_CHANNEL_ID, part: "contentDetails" });
    const playlist = channel.items?.[0]?.contentDetails.relatedPlaylists.uploads;
    if (!playlist) throw new Error("Channel uploads unavailable.");
    const uploads = await read<{ items: Array<{ contentDetails: { videoId: string } }> }>("playlistItems", { playlistId: playlist, part: "contentDetails", maxResults: "50" });
    if (!Array.isArray(uploads.items)) throw new Error("Channel uploads unavailable.");
    const [recent, pinned] = await Promise.all([
      prisma.landingFeaturedVideo.findMany({ orderBy: { publishedAt: "desc" }, take: 200 }),
      prisma.landingFeaturedVideo.findMany({ where: { pinSlot: { not: null } } }),
    ]);
    const saved = [...new Map([...recent, ...pinned].map(video => [video.id, video])).values()];
    const jobs = await prisma.socialPublishJob.findMany({ where: { platform: "youtube", status: "completed", platformPostId: { not: null },
      connectedSocialAccount: { platformAccountId: HERO_CHANNEL_ID }, platformExport: { width: { gt: 0 }, height: { gt: 0 } } },
      orderBy: { completedAt: "desc" }, take: 50, select: { platformPostId: true, platformExport: { select: { width: true, height: true } } } });
    const confirmed = new Set<string>([...HERO_SHORTS.map(video => video.id), ...saved.filter(video => video.eligible).map(video => video.id),
      ...jobs.filter(job => job.platformExport!.height! > job.platformExport!.width!).map(job => job.platformPostId!)]);
    const ids = [...new Set([...HERO_SHORTS.map(video => video.id), ...uploads.items.map(item => item.contentDetails.videoId), ...saved.map(video => video.id), ...confirmed])];
    const videos: Video[] = [];
    for (let i = 0; i < ids.length; i += 50) {
      const result = await read<{ items: Video[] }>("videos", { id: ids.slice(i, i + 50).join(","), part: "snippet,statistics,contentDetails,status" });
      if (!Array.isArray(result.items)) throw new Error("Incomplete channel metadata.");
      videos.push(...result.items);
    }
    // Validate the whole response before changing the last known good catalog.
    for (const video of videos) {
      if (!video.snippet || !video.status || !video.contentDetails || !Number.isFinite(Date.parse(video.snippet.publishedAt))) throw new Error("Incomplete video metadata.");
    }
    await prisma.$transaction(async tx => {
      await tx.landingFeaturedVideo.updateMany({ where: { id: { in: ids } }, data: { available: false } });
      for (const video of videos) {
        if (video.snippet.channelId !== HERO_CHANNEL_ID) continue;
        const duration = parseIso8601Duration(video.contentDetails.duration);
        if (!(duration > 0 && duration <= 180)) continue;
        const eligible = publicShortCandidate(video, confirmed);
        const original = HERO_SHORTS.find(short => short.id === video.id);
        const views = safeViewCount(video.statistics?.viewCount);
        const metadata = { title: video.snippet.title, ...(views !== null ? { views } : {}),
          publishedAt: new Date(video.snippet.publishedAt), durationSeconds: duration,
          available: video.status.privacyStatus === "public" && video.status.embeddable === true, refreshedAt: now };
        await tx.landingFeaturedVideo.upsert({ where: { id: video.id }, create: { id: video.id, ...metadata, eligible,
          ...(video.id === "Q7y88c4ubXc" ? { sourceVideoId: VERIFIED_COMPARISON_SOURCE.videoId, sourceStartSeconds: VERIFIED_COMPARISON_SOURCE.startSeconds, sourceEndSeconds: VERIFIED_COMPARISON_SOURCE.endSeconds } : {}),
          poster: original?.poster ?? `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg` }, update: metadata });
      }
      await tx.landingFeatureRefresh.update({ where: { id: ID, lockedBy: lease }, data: { refreshedAt: now } });
    }, { timeout: 60_000 });
    return true;
  } finally {
    await prisma.landingFeatureRefresh.updateMany({ where: { id: ID, lockedBy: lease }, data: { lockedBy: null, lockedUntil: null } });
  }
}

let started = false;
export function startFeaturedShortsPoller() {
  if (started) return;
  started = true;
  const tick = async () => {
    try { await refreshFeaturedShorts(); } catch { console.warn("[landing] Featured video refresh deferred; previous catalog retained."); }
    setTimeout(() => void tick(), 3_600_000).unref();
  };
  setTimeout(() => void tick(), 15_000).unref();
}

export async function canEditFeaturedShorts(userId: string): Promise<boolean> {
  if (process.env.LANDING_EDITOR_USER_IDS?.split(",").map(id => id.trim()).filter(Boolean).includes(userId)) return true;
  return Boolean(await prisma.connectedSocialAccount.findFirst({ where: { userId, platform: "youtube", platformAccountId: HERO_CHANNEL_ID, isActive: true }, select: { id: true } }));
}
