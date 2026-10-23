import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ state: null as { id: string; userId: string; platform: string; consumedAt: Date | null; expiresAt: Date; codeVerifier: string; redirectAfter: string } | null, exchange: vi.fn(), upsert: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: {
  socialOAuthState: {
    findUnique: vi.fn(async () => structuredClone(m.state)),
    updateMany: vi.fn(async () => { if (!m.state || m.state.consumedAt) return { count: 0 }; m.state.consumedAt = new Date(); return { count: 1 }; }),
  },
  connectedSocialAccount: { findFirst: vi.fn(async () => null), upsert: (...args: unknown[]) => m.upsert(...args) },
} }));
vi.mock("@/services/social/publishers/youtubePublisher", () => ({
  exchangeYouTubeCode: (...args: unknown[]) => m.exchange(...args), fetchYouTubeChannel: vi.fn(async () => ({ platformAccountId: "channel", displayName: "Creator", metadata: {} })),
  createPkcePair: vi.fn(), youtubeOAuthConfigured: () => true, buildYouTubeAuthUrl: vi.fn(), refreshYouTubeAccessToken: vi.fn(),
}));
vi.mock("@/services/social/publishers", () => ({ getSocialPublisher: vi.fn() }));
import { completeYouTubeOAuth } from "@/services/social/socialConnectionService";
beforeEach(() => {
  vi.clearAllMocks(); m.state = { id: "state", userId: "owner", platform: "youtube", consumedAt: null, expiresAt: new Date(Date.now() + 60_000), codeVerifier: "verifier", redirectAfter: "/clips/clip/publish" };
  m.exchange.mockResolvedValue({ accessToken: "access", refreshToken: "refresh", expiresAt: null, scope: "youtube.upload" });
  m.upsert.mockResolvedValue({ id: "account" });
});
describe("social OAuth state", () => {
  it("binds the grant to the user who initiated it", async () => {
    await expect(completeYouTubeOAuth({ code: "code", state: "random", userId: "other" })).rejects.toThrow(/expired OAuth session/i);
    expect(m.exchange).not.toHaveBeenCalled(); expect(m.upsert).not.toHaveBeenCalled();
  });
  it("rejects expired, consumed, and wrong-platform state before exchange", async () => {
    m.state!.expiresAt = new Date(Date.now() - 1);
    await expect(completeYouTubeOAuth({ code: "code", state: "random", userId: "owner" })).rejects.toThrow();
    m.state!.expiresAt = new Date(Date.now() + 60_000); m.state!.platform = "x";
    await expect(completeYouTubeOAuth({ code: "code", state: "random", userId: "owner" })).rejects.toThrow();
    m.state!.platform = "youtube"; m.state!.consumedAt = new Date();
    await expect(completeYouTubeOAuth({ code: "code", state: "random", userId: "owner" })).rejects.toThrow();
    expect(m.exchange).not.toHaveBeenCalled();
  });
  it("allows only one callback to consume a state, even concurrently", async () => {
    const results = await Promise.allSettled([1, 2].map(() => completeYouTubeOAuth({ code: "code", state: "random", userId: "owner" })));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(m.exchange).toHaveBeenCalledTimes(1); expect(m.upsert).toHaveBeenCalledTimes(1);
    const account = m.upsert.mock.calls[0][0];
    expect(account.create.encryptedAccessToken).not.toBe("access");
  });
  it("normalizes old external redirect values before returning them", async () => {
    m.state!.redirectAfter = "https://evil.example";
    expect((await completeYouTubeOAuth({ code: "code", state: "random", userId: "owner" })).redirectAfter).toBe("/settings/connected-accounts");
  });
});
