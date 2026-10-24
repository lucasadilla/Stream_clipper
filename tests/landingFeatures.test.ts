import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ videos: { findMany: vi.fn(), upsert: vi.fn(), updateMany: vi.fn() }, refresh: { findUnique: vi.fn(), upsert: vi.fn(), updateMany: vi.fn(), update: vi.fn() }, accounts: { findFirst: vi.fn() }, jobs: { findMany: vi.fn() }, transaction: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { landingFeaturedVideo: m.videos, landingFeatureRefresh: m.refresh, connectedSocialAccount: m.accounts, socialPublishJob: m.jobs, $transaction: m.transaction } }));
vi.mock("@/lib/social/http", () => ({ socialFetch: m.fetch }));
vi.mock("@/services/social/socialConnectionService", () => ({ getPublisherContext: vi.fn() }));
import { fallbackShorts, HERO_CHANNEL_ID, selectFeaturedShorts } from "@/lib/heroShorts";
import { canEditFeaturedShorts, getFeaturedShorts, publicShortCandidate, refreshFeaturedShorts } from "@/services/landingFeaturedService";
import { landingEditorInput, sameOriginMutation } from "@/lib/landingEditor";
import { SAMPLE_DURATION, sampleRange } from "@/lib/sampleTimeline";

beforeEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });
const row = (id: string, days: number, views: bigint | null, pinSlot: number | null = null) => ({ id, publishedAt: new Date(2026, 0, days), views, pinSlot, eligible: true });
describe("featured video selection", () => {
  it("keeps pin positions while automatically balancing a recent Short and popular clips", () => {
    const rows = [row("old-popular", 1, BigInt(5000)), row("newest", 5, BigInt(2)), row("pinned", 2, BigInt(0), 1), row("other", 3, BigInt(30))];
    expect(selectFeaturedShorts(rows).map(video => video.id)).toEqual(["newest", "pinned", "old-popular"]);
  });
  it("never repeats a pin, includes disabled clips, or loses BigInt precision", () => {
    const rows = [row("a", 1, BigInt("9007199254740993")), row("b", 1, BigInt("9007199254740992")), row("new", 2, null), { ...row("hidden", 3, BigInt(999)), eligible: false }];
    expect(selectFeaturedShorts(rows).map(video => video.id)).toEqual(["new", "a", "b"]);
    expect(selectFeaturedShorts([row("pin", 1, null, 2)]).map(video => video.id)).toEqual(["pin"]);
  });
  it("does not fabricate initial statistics or compare a Short against itself", () => {
    const initial = fallbackShorts();
    expect(initial.every(video => video.views === null)).toBe(true);
    const comparison = initial.find(video => video.source)!;
    expect(comparison.source?.videoId).not.toBe(comparison.id);
  });
  it("does not restore private/deleted videos after a completed refresh", async () => {
    m.videos.findMany.mockResolvedValue([]); m.refresh.findUnique.mockResolvedValue({ refreshedAt: new Date() });
    expect(await getFeaturedShorts()).toEqual([]);
  });
  it("falls back to verified videos during a first-run database outage", async () => {
    m.videos.findMany.mockRejectedValue(new Error("DB unavailable"));
    expect(await getFeaturedShorts()).toEqual(fallbackShorts());
  });
  it("does no YouTube work if the daily refresh is current or leased", async () => {
    m.refresh.updateMany.mockResolvedValue({ count: 0 });
    expect(await refreshFeaturedShorts()).toBe(false);
    expect(m.accounts.findFirst).not.toHaveBeenCalled();
  });
});
describe("public Short verification and owner controls", () => {
  const video = { id: "abcdefghijk", snippet: { channelId: HERO_CHANNEL_ID, title: "A new moment #shorts", publishedAt: "2026-10-24T00:00:00Z" }, contentDetails: { duration: "PT45S" }, status: { privacyStatus: "public", embeddable: true } };
  it("requires the selected channel, public access, embedding and an actual short signal", () => {
    expect(publicShortCandidate(video, new Set())).toBe(true);
    expect(publicShortCandidate({ ...video, snippet: { ...video.snippet, title: "Just a short upload" } }, new Set())).toBe(false);
    expect(publicShortCandidate({ ...video, snippet: { ...video.snippet, channelId: "someone-else" } }, new Set([video.id]))).toBe(false);
    expect(publicShortCandidate({ ...video, status: { privacyStatus: "private", embeddable: true } }, new Set())).toBe(false);
    expect(publicShortCandidate({ ...video, contentDetails: { duration: "PT10M" } }, new Set())).toBe(false);
  });
  it("does not let another user's YouTube connection authorize pin edits", async () => {
    m.accounts.findFirst.mockResolvedValue(null);
    expect(await canEditFeaturedShorts("user-b")).toBe(false);
    expect(m.accounts.findFirst.mock.calls[0][0].where).toEqual({ userId: "user-b", platform: "youtube", platformAccountId: HERO_CHANNEL_ID, isActive: true });
  });
  it("rejects duplicate pins, arbitrary URLs and reversed source ranges", () => {
    expect(landingEditorInput.safeParse({ pins: [video.id, video.id, null] }).success).toBe(false);
    expect(landingEditorInput.safeParse({ pins: [video.id, null, null] }).success).toBe(true);
    expect(landingEditorInput.safeParse({ id: video.id, source: { videoId: "https://evil.test", startSeconds: 0, endSeconds: 10 } }).success).toBe(false);
    expect(landingEditorInput.safeParse({ id: video.id, source: { videoId: video.id, startSeconds: 20, endSeconds: 10 } }).success).toBe(false);
    expect(landingEditorInput.safeParse({ id: video.id, source: { videoId: video.id, startSeconds: 0, endSeconds: 181 } }).success).toBe(false);
  });
  it("blocks cross-site writes before authentication or database work", () => {
    const request = (origin: string) => new Request("https://streamclipper.stream/api/landing/editor", { method: "PATCH", headers: { origin, "content-type": "application/json" } });
    expect(sameOriginMutation(request("https://evil.test"))).toBe(false);
    expect(sameOriginMutation(request("https://streamclipper.stream"))).toBe(true);
  });
});
describe("sample selection bounds", () => {
  it("always produces a playable bounded range, including crossed handles and invalid input", () => {
    for (const [start, end] of [[-10, 999], [60, 10], [70, 70], [NaN, Infinity], [12.6, 44.2]]) {
      const result = sampleRange(start, end);
      expect(result.start).toBeGreaterThanOrEqual(0); expect(result.end).toBeLessThanOrEqual(SAMPLE_DURATION);
      expect(result.end).toBeGreaterThan(result.start);
    }
  });
});

describe("daily catalog refresh", () => {
  beforeEach(() => {
    vi.stubEnv("YOUTUBE_API_KEY", "test-only-key");
    m.refresh.updateMany.mockResolvedValue({ count: 1 });
    m.videos.findMany.mockResolvedValue([]); m.jobs.findMany.mockResolvedValue([]);
    m.transaction.mockImplementation(async callback => callback({ landingFeaturedVideo: m.videos, landingFeatureRefresh: m.refresh }));
    m.fetch.mockResolvedValueOnce(Response.json({ items: [{ contentDetails: { relatedPlaylists: { uploads: "channel-uploads" } } }] }))
      .mockResolvedValueOnce(Response.json({ items: [{ contentDetails: { videoId: "abcdefghijk" } }] }));
  });
  const video = { id: "abcdefghijk", snippet: { channelId: HERO_CHANNEL_ID, title: "New #shorts", publishedAt: "2026-10-24T00:00:00Z" }, contentDetails: { duration: "PT45S" }, statistics: { viewCount: "9876" }, status: { privacyStatus: "public", embeddable: true } };
  it("stores real counts without overwriting owner pins or source mappings", async () => {
    m.fetch.mockResolvedValueOnce(Response.json({ items: [video] }));
    await refreshFeaturedShorts(new Date("2026-10-24T15:00:00Z"));
    const write = m.videos.upsert.mock.calls[0][0];
    expect(write.create).toMatchObject({ id: video.id, eligible: true, views: BigInt(9876), available: true });
    expect(write.update.pinSlot).toBeUndefined(); expect(write.update.sourceVideoId).toBeUndefined(); expect(write.update.eligible).toBeUndefined();
    expect(m.refresh.update.mock.calls[0][0].data.refreshedAt).toEqual(new Date("2026-10-24T15:00:00Z"));
  });
  it("does not wipe the last catalog if YouTube fails or sends malformed metadata", async () => {
    m.fetch.mockResolvedValueOnce(Response.json({ error: "unavailable" }, { status: 503 }));
    await expect(refreshFeaturedShorts()).rejects.toThrow("temporarily unavailable");
    expect(m.transaction).not.toHaveBeenCalled();
    expect(m.videos.updateMany).not.toHaveBeenCalled();
    expect(m.refresh.updateMany.mock.calls.at(-1)?.[0].data).toEqual({ lockedBy: null, lockedUntil: null });
  });
  it("hides videos that become private and keeps the last known count when statistics are omitted", async () => {
    m.fetch.mockResolvedValueOnce(Response.json({ items: [{ ...video, statistics: {}, status: { privacyStatus: "private", embeddable: true } }] }));
    await refreshFeaturedShorts();
    expect(m.videos.upsert.mock.calls[0][0].update.available).toBe(false);
    expect(m.videos.upsert.mock.calls[0][0].update.views).toBeUndefined();
  });
});
