import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exchangeMetaCode, fetchMetaPages } from "@/services/social/publishers/metaOAuth";

const http = vi.fn();
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const page = (id: string) => ({ id, name: `Page ${id}`, access_token: `page-token-${id}` });

beforeEach(() => {
  http.mockReset();
  vi.stubGlobal("fetch", http);
  vi.stubEnv("META_APP_ID", "app-id");
  vi.stubEnv("META_APP_SECRET", "test-secret");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("Meta Page discovery", () => {
  it("collects later pages and deduplicates accounts across pages", async () => {
    http.mockResolvedValueOnce(json({ data: [page("1")], paging: { next: "https://graph.facebook.com/next", cursors: { after: "cursor-1" } } }))
      .mockResolvedValueOnce(json({ data: [page("1"), page("2")] }));
    expect((await fetchMetaPages("user-token")).map((account) => account.id)).toEqual(["1", "2"]);
    const secondUrl = new URL(http.mock.calls[1][0]);
    expect(secondUrl.pathname).toMatch(/\/me\/accounts$/);
    expect(secondUrl.searchParams.get("after")).toBe("cursor-1");
    expect(secondUrl.searchParams.has("access_token")).toBe(false);
    expect(http.mock.calls[1][1].headers.Authorization).toBe("Bearer user-token");
  });

  it("uses only the cursor even when the supplied next URL is on another host", async () => {
    http.mockResolvedValueOnce(json({ data: [], paging: { next: "https://unexpected.example/collect", cursors: { after: "next" } } }))
      .mockResolvedValueOnce(json({ data: [page("2")] }));
    expect(await fetchMetaPages("user-token")).toHaveLength(1);
    expect(new URL(http.mock.calls[1][0]).hostname).toBe("graph.facebook.com");
  });

  it("does not treat a cursor without a next link as another page", async () => {
    http.mockResolvedValueOnce(json({ data: [page("1")], paging: { cursors: { after: "last" } } }));
    expect(await fetchMetaPages("token")).toHaveLength(1);
    expect(http).toHaveBeenCalledTimes(1);
  });

  it("rejects repeated cursors instead of looping or returning partial accounts", async () => {
    http.mockImplementation(async () => json({ data: [page("1")], paging: { next: "next", cursors: { after: "same" } } }));
    await expect(fetchMetaPages("token")).rejects.toThrow(/incomplete Page results/);
    expect(http).toHaveBeenCalledTimes(2);
  });

  it("rejects incomplete pagination and errors on later pages", async () => {
    http.mockResolvedValueOnce(json({ data: [page("1")], paging: { next: "next" } }));
    await expect(fetchMetaPages("token")).rejects.toThrow(/incomplete Page results/);
    http.mockResolvedValueOnce(json({ data: [page("1")], paging: { next: "next", cursors: { after: "a" } } }))
      .mockResolvedValueOnce(json({ error: { message: "Permission expired" } }, 403));
    await expect(fetchMetaPages("token")).rejects.toThrow("Permission expired");
  });

  it("does not report malformed responses as an empty Page list", async () => {
    http.mockResolvedValueOnce(json({}));
    await expect(fetchMetaPages("token")).rejects.toThrow(/Could not load/);
  });
});

describe("Meta token extension", () => {
  it("uses the extended token and its own expiry", async () => {
    http.mockResolvedValueOnce(json({ access_token: "short", expires_in: 3600 }))
      .mockResolvedValueOnce(json({ access_token: "long", expires_in: 86400 }));
    const before = Date.now();
    const result = await exchangeMetaCode({ code: "code", platform: "facebook" });
    expect(result.accessToken).toBe("long");
    expect(result.expiresAt!.getTime()).toBeGreaterThanOrEqual(before + 86400_000);
  });

  it("keeps the original token's expiry when extension is rejected", async () => {
    http.mockResolvedValueOnce(json({ access_token: "short", expires_in: 3600 }))
      .mockResolvedValueOnce(json({ access_token: "unusable", expires_in: 86400 }, 400));
    const before = Date.now();
    const result = await exchangeMetaCode({ code: "code", platform: "instagram" });
    expect(result.accessToken).toBe("short");
    expect(result.expiresAt!.getTime()).toBeLessThanOrEqual(before + 3600_000 + 1000);
  });

  it("does not attach the old short expiry to a successful extension without an expiry", async () => {
    http.mockResolvedValueOnce(json({ access_token: "short", expires_in: 3600 }))
      .mockResolvedValueOnce(json({ access_token: "long" }));
    expect(await exchangeMetaCode({ code: "code", platform: "facebook" })).toEqual({ accessToken: "long", expiresAt: null });
  });
});
