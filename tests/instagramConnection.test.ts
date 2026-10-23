import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  state: null as null | Record<string, unknown>,
  create: vi.fn(), upsert: vi.fn(), update: vi.fn(), exchange: vi.fn(), profile: vi.fn(),
  metaExchange: vi.fn(), pages: vi.fn(), getTokens: vi.fn(), storeTokens: vi.fn(), refresh: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: {
  socialOAuthState: {
    create: m.create, findUnique: vi.fn(async () => m.state), updateMany: vi.fn(async () => ({ count: 1 })),
  },
  connectedSocialAccount: { findFirst: vi.fn(async () => null), upsert: m.upsert, update: m.update },
} }));
vi.mock("@/services/socialTokenService", async (original) => ({ ...await original<typeof import("@/services/socialTokenService")>(), getDecryptedTokens: m.getTokens, storeAccountTokens: m.storeTokens }));
vi.mock("@/services/social/publishers/instagramOAuth", async (original) => ({ ...await original<typeof import("@/services/social/publishers/instagramOAuth")>(), exchangeInstagramCode: m.exchange, fetchDirectInstagramProfile: m.profile, refreshInstagramAccessToken: m.refresh }));
vi.mock("@/services/social/publishers/metaOAuth", async (original) => ({ ...await original<typeof import("@/services/social/publishers/metaOAuth")>(), exchangeMetaCode: m.metaExchange, fetchMetaPages: m.pages }));
vi.mock("@/services/social/publishers", () => ({ getSocialPublisher: vi.fn() }));
import { beginOAuthConnect, completeMetaOAuth, getPublisherContext } from "@/services/social/socialConnectionService";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("INSTAGRAM_CLIENT_ID", "direct-id"); vi.stubEnv("INSTAGRAM_CLIENT_SECRET", "direct-secret");
  vi.stubEnv("META_APP_ID", "meta-id"); vi.stubEnv("META_APP_SECRET", "meta-secret");
  m.state = { id: "state", userId: "owner", platform: "instagram", expiresAt: new Date(Date.now() + 60000), consumedAt: null, codeVerifier: "instagram_login", redirectAfter: "/clips/clip/publish" };
  m.exchange.mockResolvedValue({ accessToken: "long", expiresAt: new Date(Date.now() + 60 * 86400000), scope: "instagram_business_basic instagram_business_content_publish" });
  m.profile.mockResolvedValue({ id: "professional-id", username: "creator", name: "Creator", profilePictureUrl: null });
  m.upsert.mockResolvedValue({ id: "account" });
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("Instagram connection routing", () => {
  it("binds a direct Instagram grant to its original route in the persisted state", async () => {
    const { url } = await beginOAuthConnect({ userId: "owner", platform: "instagram" });
    expect(new URL(url).hostname).toBe("www.instagram.com");
    expect(m.create.mock.calls[0][0].data).toMatchObject({ userId: "owner", platform: "instagram", codeVerifier: "instagram_login" });
  });
  it("stores the professional ID and encrypted direct token, removing any old Page refresh token", async () => {
    const result = await completeMetaOAuth({ state: "state", code: "code", platform: "instagram", userId: "owner" });
    expect(result).toEqual({ redirectAfter: "/clips/clip/publish", accountIds: ["account"] });
    expect(m.pages).not.toHaveBeenCalled(); expect(m.metaExchange).not.toHaveBeenCalled();
    const saved = m.upsert.mock.calls[0][0];
    expect(saved.create.platformAccountId).toBe("professional-id");
    expect(saved.create.encryptedAccessToken).not.toBe("long");
    expect(saved.update).toMatchObject({ encryptedRefreshToken: null, accountMetadata: { authType: "instagram_login", igUserId: "professional-id" } });
  });
  it("finishes a legacy Page grant through Facebook even if direct login was enabled meanwhile", async () => {
    m.state!.codeVerifier = null;
    m.metaExchange.mockResolvedValue({ accessToken: "page-user-token", expiresAt: null }); m.pages.mockResolvedValue([]);
    await expect(completeMetaOAuth({ state: "state", code: "code", platform: "instagram", userId: "owner" })).rejects.toThrow(/No Facebook Pages/);
    expect(m.exchange).not.toHaveBeenCalled(); expect(m.metaExchange).toHaveBeenCalledOnce();
  });
  it("rejects the wrong signed-in owner before exchanging an Instagram code", async () => {
    await expect(completeMetaOAuth({ state: "state", code: "code", platform: "instagram", userId: "other" })).rejects.toThrow(/Invalid or expired/);
    expect(m.exchange).not.toHaveBeenCalled(); expect(m.upsert).not.toHaveBeenCalled();
  });
  it("renews a direct long-lived token without a refresh token before it expires", async () => {
    m.getTokens.mockResolvedValue({ accessToken: "old", refreshToken: null, platform: "instagram", accountMetadata: { authType: "instagram_login" }, expiresAt: new Date(Date.now() + 3 * 86400000) });
    const expiresAt = new Date(Date.now() + 60 * 86400000); m.refresh.mockResolvedValue({ accessToken: "renewed", expiresAt });
    expect((await getPublisherContext("account")).accessToken).toBe("renewed");
    expect(m.refresh).toHaveBeenCalledWith("old");
    expect(m.storeTokens).toHaveBeenCalledWith({ accountId: "account", accessToken: "renewed", expiresAt });
  });
  it("asks for reconnection when renewal fails and does not publish with the stale token", async () => {
    m.getTokens.mockResolvedValue({ accessToken: "expired", refreshToken: null, platform: "instagram", accountMetadata: { authType: "instagram_login" }, expiresAt: new Date(Date.now() - 1) });
    m.refresh.mockRejectedValue(new Error("invalid token"));
    await expect(getPublisherContext("account")).rejects.toMatchObject({ code: "needs_reauth" });
    expect(m.storeTokens).not.toHaveBeenCalled(); expect(m.update).toHaveBeenCalledOnce();
  });
});
