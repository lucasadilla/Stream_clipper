import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyAccountViewScan, fetchAccountViewsPage } from "@/services/social/accountViewsService";
const http = vi.fn();
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const ctx = { accessToken: "private-token" };
const account = (platform: string, grantedScopes: string | null = null) => ({ platform, platformAccountId: "account", grantedScopes });
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal("fetch", http); });
afterEach(() => vi.unstubAllGlobals());
describe("whole connected-account view totals", () => {
  it("reads the YouTube channel total rather than only Clipper's published videos", async () => {
    http.mockResolvedValue(response({ items: [{ id: "account", statistics: { viewCount: "12345678901234567" } }] }));
    expect(await fetchAccountViewsPage(account("youtube"), ctx, emptyAccountViewScan())).toMatchObject({ views: BigInt("12345678901234567"), cursor: null });
    expect(String(http.mock.calls[0][0])).toBe("https://www.googleapis.com/youtube/v3/channels?part=statistics&id=account");
    expect(http.mock.calls[0][1].headers.Authorization).toBe("Bearer private-token");
  });
  it("walks every TikTok page, excluding overlap instead of counting it twice", async () => {
    http.mockResolvedValueOnce(response({ data: { videos: [{ id: "first", view_count: 10 }], has_more: true, cursor: 123 }, error: { code: "ok" } }))
      .mockResolvedValueOnce(response({ data: { videos: [{ id: "first", view_count: 10 }, { id: "second", view_count: 20 }], has_more: false }, error: { code: "ok" } }));
    const first = await fetchAccountViewsPage(account("tiktok", "video.list"), ctx, emptyAccountViewScan());
    const second = await fetchAccountViewsPage(account("tiktok", "video.list"), ctx, { cursor: first.cursor, seen: first.seen, total: first.views.toString(), pages: 1, items: first.items });
    expect(first.views + second.views).toBe(BigInt(30)); expect(second.cursor).toBeNull();
    expect(JSON.parse(http.mock.calls[1][1].body)).toMatchObject({ cursor: 123 });
  });
  it("rejects missing analytics access before making avoidable provider calls", async () => {
    await expect(fetchAccountViewsPage(account("tiktok"), ctx, emptyAccountViewScan())).rejects.toThrow(/video.list/);
    await expect(fetchAccountViewsPage(account("instagram"), ctx, emptyAccountViewScan())).rejects.toThrow(/insights/);
    expect(http).not.toHaveBeenCalled();
  });
  it("never substitutes likes or impressions for unavailable views", async () => {
    http.mockResolvedValue(response({ data: { videos: [{ id: "video", like_count: 20 }], has_more: false }, error: { code: "ok" } }));
    await expect(fetchAccountViewsPage(account("tiktok", "video.list"), ctx, emptyAccountViewScan())).rejects.toThrow(/view count/);
  });
  it("does not treat a malformed list response as an empty account with zero views", async () => {
    http.mockResolvedValue(response({ data: {}, error: { code: "ok" } }));
    await expect(fetchAccountViewsPage(account("tiktok", "video.list"), ctx, emptyAccountViewScan())).rejects.toThrow(/Incomplete/);
  });
  it("builds Instagram pagination on the fixed graph host, ignoring untrusted next URLs", async () => {
    http.mockResolvedValueOnce(response({ data: [{ id: "media" }], paging: { next: "https://attacker.test/private-token", cursors: { after: "safe-cursor" } } }))
      .mockResolvedValueOnce(response({ data: [{ name: "views", values: [{ value: 25 }] }] }));
    const page = await fetchAccountViewsPage(account("instagram", "instagram_business_manage_insights"), { ...ctx, accountMetadata: { authType: "instagram_login" } }, emptyAccountViewScan());
    expect(page).toMatchObject({ views: BigInt(25), cursor: "safe-cursor" });
    expect(http.mock.calls.every(call => String(call[0]).startsWith("https://graph.instagram.com/"))).toBe(true);
  });
  it("rejects stalled pagination rather than generating an endless daily scan", async () => {
    http.mockResolvedValue(response({ data: { videos: [], has_more: true, cursor: 123 }, error: { code: "ok" } }));
    await expect(fetchAccountViewsPage(account("tiktok", "video.list"), ctx, { ...emptyAccountViewScan(), cursor: "123" })).rejects.toThrow(/did not advance/);
  });
  it("does not publish X's limited recent history as all-time account views", async () => {
    http.mockResolvedValueOnce(response({ data: [{ id: "post" }], includes: { media: [{ type: "video", media_key: "video", public_metrics: { view_count: 99 } }] }, meta: {} }))
      .mockResolvedValueOnce(response({ data: { public_metrics: { tweet_count: 4000 } } }));
    await expect(fetchAccountViewsPage(account("x"), ctx, emptyAccountViewScan())).rejects.toThrow(/complete account history/);
  });
});
