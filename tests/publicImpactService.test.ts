import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  snapshot: { upsert: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
  metrics: { createMany: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  accounts: { findMany: vi.fn(), findFirst: vi.fn() }, query: vi.fn(), page: vi.fn(), context: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: { publicImpactSnapshot: m.snapshot, publicAccountMetric: m.metrics, connectedSocialAccount: m.accounts, $queryRaw: m.query } }));
vi.mock("@/services/social/accountViewsService", async importOriginal => ({ ...await importOriginal<typeof import("@/services/social/accountViewsService")>(), fetchAccountViewsPage: m.page }));
vi.mock("@/services/social/socialConnectionService", () => ({ getPublisherContext: m.context }));
import { getPublicImpact, refreshPublicImpactBatch } from "@/services/publicImpactService";
const now = new Date("2026-10-23T16:00:00Z"), day = new Date("2026-10-23T00:00:00Z");
beforeEach(() => {
  vi.resetAllMocks();
  m.snapshot.updateMany.mockResolvedValue({ count: 1 });
  m.snapshot.findUniqueOrThrow.mockResolvedValue({ day, phase: "metrics", cursor: null });
  m.metrics.findMany.mockResolvedValue([]); m.context.mockResolvedValue({ accessToken: "secret" });
  m.query.mockResolvedValue([{ totalViews: "123", countedAccounts: BigInt(1), knownAccounts: BigInt(2), refreshedAt: now }]);
  m.accounts.findFirst.mockResolvedValue({ id: "a", platform: "youtube", platformAccountId: "channel", grantedScopes: null });
});
describe("daily connected-account views", () => {
  it("serves a stored total without querying providers or exposing private identities", async () => {
    m.snapshot.findUnique.mockResolvedValue({ totalViews: BigInt(123), countedAccounts: 1, knownAccounts: 2, refreshedAt: now, lockedBy: "private", cursor: "account" });
    expect(await getPublicImpact()).toEqual({ totalViews: "123", countedAccounts: 1, knownAccounts: 2, refreshedAt: now.toISOString() });
    expect(m.page).not.toHaveBeenCalled(); expect(m.accounts.findMany).not.toHaveBeenCalled();
  });
  it("does no work when today's sweep is complete or another instance holds the lease", async () => {
    m.snapshot.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await refreshPublicImpactBatch(now)).toBe(false);
    expect(m.metrics.findMany).not.toHaveBeenCalled();
  });
  it("discovers connected accounts, including those with no Clipper publishing jobs", async () => {
    m.snapshot.findUniqueOrThrow.mockResolvedValue({ day, phase: "discover", cursor: "cursor" });
    m.accounts.findMany.mockResolvedValue([{ id: "a", platform: "youtube", platformAccountId: "channel" }]);
    await refreshPublicImpactBatch(now);
    expect(m.accounts.findMany.mock.calls[0][0].where).toEqual({ isActive: true, id: { gt: "cursor" } });
    expect(m.metrics.createMany.mock.calls[0][0]).toEqual({ skipDuplicates: true, data: [{ platform: "youtube", platformAccountId: "channel" }] });
  });
  it("persists a partial account scan without replacing the previous published lifetime count", async () => {
    m.metrics.findMany.mockResolvedValue([{ id: "metric", platform: "tiktok", platformAccountId: "account", scanDay: null }]);
    m.page.mockResolvedValue({ views: BigInt(17), cursor: "next", seen: ["video"], items: 1 });
    await refreshPublicImpactBatch(now);
    const data = m.metrics.update.mock.calls[0][0].data;
    expect(data.scanState).toMatchObject({ total: "17", cursor: "next", items: 1 });
    expect(data.views).toBeUndefined(); expect(data.attemptedAt).toBeUndefined();
  });
  it("resumes the next page and publishes only a completed account sum", async () => {
    m.metrics.findMany.mockResolvedValue([{ id: "metric", platform: "tiktok", platformAccountId: "account", scanDay: day, scanState: { total: "17", cursor: "next", seen: ["video"], pages: 1, items: 1 } }]);
    m.page.mockResolvedValue({ views: BigInt(23), cursor: null, seen: ["video", "second"], items: 1 });
    await refreshPublicImpactBatch(now);
    expect(m.page.mock.calls[0][2]).toMatchObject({ total: "17", cursor: "next" });
    expect(m.metrics.update.mock.calls[0][0].data).toMatchObject({ views: BigInt(40), attemptedAt: now, scanState: {} });
  });
  it("retains a complete count on permission errors, and never adds an error as zero", async () => {
    m.metrics.findMany.mockResolvedValue([{ id: "metric", platform: "youtube", platformAccountId: "channel" }]);
    m.page.mockRejectedValue(new Error("permission error containing secret"));
    await refreshPublicImpactBatch(now);
    expect(m.metrics.update.mock.calls[0][0].data).toEqual({ attemptedAt: now, scanState: {} });
  });
  it("aggregates only active provider identities once, replacing rather than incrementing the snapshot", async () => {
    await refreshPublicImpactBatch(now);
    expect(String(m.query.mock.calls[0][0])).toContain('EXISTS');
    expect(String(m.query.mock.calls[0][0])).toContain('"isActive" = true');
    expect(m.snapshot.update.mock.calls[0][0].data).toMatchObject({ phase: "complete", totalViews: BigInt(123), countedAccounts: 1, knownAccounts: 2 });
    expect(m.snapshot.updateMany.mock.calls.at(-1)?.[0].data).toEqual({ lockedBy: null, lockedUntil: null });
  });
});
