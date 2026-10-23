import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ http: vi.fn(), events: [] as Array<Record<string, unknown>>, claimed: false, reconnected: false, queries: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: {
  socialPublishJob: {
    findFirst: vi.fn(async ({ where }) => where.publishGroup.userId === "owner" ? { id: where.id, platform: "youtube", platformPostId: "video", connectedSocialAccountId: "account", createdAt: new Date(), completedAt: new Date(), connectedSocialAccount: { grantedScopes: "youtube.readonly", updatedAt: new Date(m.reconnected ? Date.now() + 1000 : 0) }, events: m.events.slice(-1).reverse() } : null),
    findMany: vi.fn(async ({ where }) => { m.queries(where); return where.publishGroup.userId === "owner" ? where.id.in.map((id: string) => ({ id, events: [...m.events].reverse() })) : []; }),
    updateMany: vi.fn(async ({ data }) => { if (data.lockedBy === null) { m.claimed = false; return { count: 1 }; } if (m.claimed) return { count: 0 }; m.claimed = true; return { count: 1 }; }),
  },
  socialPublishEvent: { create: vi.fn(async ({ data }) => { m.events.push({ ...data, createdAt: new Date() }); }), deleteMany: vi.fn() },
} }));
vi.mock("@/services/social/socialConnectionService", () => ({ getPublisherContext: async () => ({ accessToken: "private-token" }) }));
import { fetchPostMetrics, getPostPerformance, refreshPostPerformance } from "@/services/social/socialPerformanceService";
import { metricNumber } from "@/lib/social/performance";
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const ctx = { accessToken: "private-token" };
beforeEach(() => { vi.clearAllMocks(); m.events = []; m.claimed = false; m.reconnected = false; vi.stubGlobal("fetch", m.http); });
afterEach(() => vi.unstubAllGlobals());
describe("real provider performance", () => {
  it("keeps missing counts unavailable and distinguishes them from zero", () => {
    expect([undefined, null, "", "bad", true].map(metricNumber)).toEqual([null, null, null, null, null]);
    expect(metricNumber("0")).toBe(0); expect(metricNumber("128")).toBe(128);
  });
  it("reads YouTube counts without pretending missing watch time is zero", async () => {
    m.http.mockResolvedValueOnce(json({ items: [{ id: "video", statistics: { viewCount: "150", likeCount: "0" } }] }));
    expect(await fetchPostMetrics("youtube", "video", ctx, new Date(), null)).toMatchObject({ views: 150, likes: 0, comments: null, averageViewPercent: null });
    expect(m.http).toHaveBeenCalledOnce();
  });
  it("maps YouTube Analytics columns by name, preserving actual percentage viewed", async () => {
    m.http.mockResolvedValueOnce(json({ items: [{ id: "video", statistics: { viewCount: "150" } }] }))
      .mockResolvedValueOnce(json({ columnHeaders: [{ name: "averageViewPercentage" }, { name: "shares" }, { name: "averageViewDuration" }], rows: [[78.5, 9, 23.4]] }));
    expect(await fetchPostMetrics("youtube", "video", ctx, new Date(), "yt-analytics.readonly")).toMatchObject({ averageViewPercent: 78.5, averageWatchSeconds: 23.4, shares: 9 });
    expect(String(m.http.mock.calls[1][0])).toContain("filters=video%3D%3Dvideo");
  });
  it("does not call TikTok without video.list, and queries the stored video ID when granted", async () => {
    await expect(fetchPostMetrics("tiktok", "video", ctx, new Date(), "video.publish")).rejects.toThrow(/video.list/);
    expect(m.http).not.toHaveBeenCalled();
    m.http.mockResolvedValueOnce(json({ data: { videos: [{ id: "video", view_count: 99, like_count: 3, share_count: 0 }] }, error: { code: "ok" } }));
    expect(await fetchPostMetrics("tiktok", "video", ctx, new Date(), "video.list")).toMatchObject({ views: 99, likes: 3, comments: null, shares: 0 });
    expect(JSON.parse(m.http.mock.calls[0][1].body)).toEqual({ filters: { video_ids: ["video"] } });
  });
  it("does not label X impressions as video views and uses actual playback completion", async () => {
    m.http.mockResolvedValueOnce(json({ data: { id: "post", attachments: { media_keys: ["media"] }, public_metrics: { impression_count: 4000, like_count: 10, retweet_count: 2, quote_count: 1 } },
      includes: { media: [{ media_key: "media", type: "video", public_metrics: { view_count: 300 }, non_public_metrics: { playback_0_count: 100, playback_100_count: 25 } }] } }));
    expect(await fetchPostMetrics("x", "post", ctx, new Date(), null)).toMatchObject({ views: 300, impressions: 4000, completionPercent: 25, shares: 3, averageViewPercent: null });
  });
  it("preserves Instagram engagement if insights permission is missing", async () => {
    m.http.mockResolvedValueOnce(json({ id: "media", like_count: 12, comments_count: 2 })).mockResolvedValueOnce(json({ error: { code: 190 } }, 403));
    expect(await fetchPostMetrics("instagram", "media", { ...ctx, accountMetadata: { authType: "instagram_login" } }, new Date(), null)).toMatchObject({ likes: 12, comments: 2, views: null });
    expect(String(m.http.mock.calls[0][0])).toContain("graph.instagram.com");
  });
  it("caches checks for an hour and never returns credentials or raw provider payloads", async () => {
    m.http.mockResolvedValue(json({ items: [{ id: "video", statistics: { viewCount: "10" } }] }));
    await refreshPostPerformance("owner", ["job"]); await refreshPostPerformance("owner", ["job"]);
    expect(m.http).toHaveBeenCalledOnce();
    const result = await getPostPerformance("owner", ["job"]);
    expect(result[0].metrics?.views).toBe(10); expect(result[0].history).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("private-token");
    expect(await getPostPerformance("other", ["job"])).toEqual([]);
  });
  it("allows an immediate retry of a permission error after the account is reconnected", async () => {
    m.events = [{ type: "performance_check", createdAt: new Date(), safeMetadata: { error: "Reconnect account" } }];
    await refreshPostPerformance("owner", ["job"]); expect(m.http).not.toHaveBeenCalled();
    m.reconnected = true;
    m.http.mockResolvedValueOnce(json({ items: [{ id: "video", statistics: { viewCount: "15" } }] }));
    const result = await refreshPostPerformance("owner", ["job"]);
    expect(m.http).toHaveBeenCalledOnce(); expect(result[0].metrics?.views).toBe(15); expect(result[0].error).toBeNull();
  });
  it("does not replace a previous successful snapshot with zeros on permission failure", async () => {
    m.events = [{ type: "performance_snapshot", createdAt: new Date(Date.now() - 2 * 3600000), safeMetadata: { metrics: { views: 123 } } }];
    m.http.mockResolvedValueOnce(json({ error: { code: 403 } }, 403));
    const results = await refreshPostPerformance("owner", ["job"]);
    expect(results[0].metrics?.views).toBe(123); expect(results[0].error).toContain("permission");
  });
  it("rejects arbitrary URLs as provider IDs before making network requests", async () => {
    await expect(fetchPostMetrics("youtube", "https://other.test", ctx, new Date(), null)).rejects.toThrow(/published video ID/);
    expect(m.http).not.toHaveBeenCalled();
  });
});
