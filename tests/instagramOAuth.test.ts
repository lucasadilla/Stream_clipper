import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildInstagramAuthUrl, exchangeInstagramCode, fetchDirectInstagramProfile, instagramGraph, INSTAGRAM_GRAPH, refreshInstagramAccessToken } from "@/services/social/publishers/instagramOAuth";
import { getPlatformCapability } from "@/lib/social/capabilities";

const http = vi.fn();
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const permissions = "instagram_business_basic,instagram_business_content_publish";
beforeEach(() => {
  http.mockReset(); vi.stubGlobal("fetch", http);
  vi.stubEnv("INSTAGRAM_CLIENT_ID", "ig-app"); vi.stubEnv("INSTAGRAM_CLIENT_SECRET", "secret");
  vi.stubEnv("INSTAGRAM_REDIRECT_URI", "https://clipper.example/api/social/oauth/instagram/callback");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("Instagram direct connection", () => {
  it("requests only profile and publishing from the Instagram app", () => {
    const url = new URL(buildInstagramAuthUrl("bound-state"));
    expect(url.origin).toBe("https://www.instagram.com");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ client_id: "ig-app", state: "bound-state", scope: permissions });
    expect(url.searchParams.has("client_secret")).toBe(false);
    vi.stubEnv("META_APP_ID", ""); vi.stubEnv("META_APP_SECRET", "");
    expect(getPlatformCapability("instagram")).toBe("development_only");
    expect(getPlatformCapability("facebook")).toBe("not_configured");
  });
  it("does not inherit Facebook's callback from a legacy Meta redirect setting", () => {
    vi.stubEnv("INSTAGRAM_REDIRECT_URI", "");
    vi.stubEnv("META_REDIRECT_URI", "https://clipper.example/api/social/oauth/facebook/callback");
    expect(new URL(buildInstagramAuthUrl("state")).searchParams.get("redirect_uri")).toMatch(/\/oauth\/instagram\/callback$/);
  });
  it.each([false, true])("accepts flat and wrapped code responses, then obtains a long-lived token (wrapped=%s)", async (wrapped) => {
    const grant = { access_token: "short", user_id: "app-scoped", permissions };
    http.mockResolvedValueOnce(json(wrapped ? { data: [grant] } : grant))
      .mockResolvedValueOnce(json({ access_token: "long", expires_in: 5184000 }));
    const result = await exchangeInstagramCode("code");
    expect(result.accessToken).toBe("long");
    expect(result.scope).toBe(permissions.replace(",", " "));
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now() + 59 * 86400000);
    expect(http.mock.calls[0][0]).toBe("https://api.instagram.com/oauth/access_token");
    expect(http.mock.calls[0][1].body.get("client_id")).toBe("ig-app");
    expect(http.mock.calls[0][1].body.get("redirect_uri")).toBe("https://clipper.example/api/social/oauth/instagram/callback");
    expect(new URL(http.mock.calls[1][0]).searchParams.get("grant_type")).toBe("ig_exchange_token");
  });
  it("does not save a connection when publishing was declined or long-lived exchange fails", async () => {
    http.mockResolvedValueOnce(json({ access_token: "short", permissions: "instagram_business_basic" }));
    await expect(exchangeInstagramCode("code")).rejects.toThrow(/publishing permission/);
    expect(http).toHaveBeenCalledTimes(1);
    http.mockResolvedValueOnce(json({ access_token: "short", permissions }))
      .mockResolvedValueOnce(json({ error: { message: "token expired" } }, 400));
    await expect(exchangeInstagramCode("code")).rejects.toThrow("token expired");
  });
  it("rejects ambiguous token responses", async () => {
    http.mockResolvedValueOnce(json({ data: [{ access_token: "one" }, { access_token: "two" }] }));
    await expect(exchangeInstagramCode("code")).rejects.toThrow(/ambiguous/);
    expect(http).toHaveBeenCalledTimes(1);
  });
  it.each([false, true])("uses the professional user_id rather than the app-scoped id (wrapped=%s)", async (wrapped) => {
    const profile = { id: "app-scoped", user_id: "professional", username: "creator", account_type: "MEDIA_CREATOR" };
    http.mockResolvedValueOnce(json(wrapped ? { data: [profile] } : profile));
    expect(await fetchDirectInstagramProfile("access")).toMatchObject({ id: "professional", username: "creator" });
    expect(http.mock.calls[0][1].headers.Authorization).toBe("Bearer access");
    expect(http.mock.calls[0][0]).toContain("/me?fields=user_id,");
  });
  it("refreshes using the long-lived access token and rejects invalid expiry", async () => {
    http.mockResolvedValueOnce(json({ access_token: "renewed", expires_in: 5184000 }));
    expect((await refreshInstagramAccessToken("long")).accessToken).toBe("renewed");
    expect(new URL(http.mock.calls[0][0]).searchParams.get("grant_type")).toBe("ig_refresh_token");
    http.mockResolvedValueOnce(json({ access_token: "unusable", expires_in: 0 }));
    await expect(refreshInstagramAccessToken("long")).rejects.toThrow(/renew/);
  });
  it("selects the API host from each saved account, preserving existing Page connections", () => {
    expect(instagramGraph({ authType: "instagram_login" })).toBe(INSTAGRAM_GRAPH);
    expect(instagramGraph({ pageId: "page" })).toContain("graph.facebook.com");
    expect(instagramGraph(null)).toContain("graph.facebook.com");
  });
});
