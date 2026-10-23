import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  snapshot: { upsert: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
  metrics: { createMany: vi.fn(), findMany: vi.fn(), update: vi.fn(), aggregate: vi.fn(), count: vi.fn() },
  jobs: { findMany: vi.fn() }, fetchMetrics: vi.fn(), context: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: { publicImpactSnapshot: m.snapshot, publicPostMetric: m.metrics, socialPublishJob: m.jobs } }));
vi.mock("@/services/social/socialPerformanceService", () => ({ fetchPostMetrics: m.fetchMetrics }));
vi.mock("@/services/social/socialConnectionService", () => ({ getPublisherContext: m.context }));
import { getPublicImpact, refreshPublicImpactBatch } from "@/services/publicImpactService";
const now = new Date("2026-10-23T16:00:00Z"), day = new Date("2026-10-23T00:00:00Z");
beforeEach(() => {
  vi.resetAllMocks();
  m.snapshot.updateMany.mockResolvedValue({ count: 1 });
  m.snapshot.findUniqueOrThrow.mockResolvedValue({ day, phase: "metrics", cursor: null });
  m.metrics.findMany.mockResolvedValue([]); m.context.mockResolvedValue({ accessToken: "secret" });
  m.metrics.aggregate.mockResolvedValue({ _sum: { views: BigInt(123) }, _count: { id: 1 }, _max: { fetchedAt: now } }); m.metrics.count.mockResolvedValue(2);
});
describe("daily public view collection", () => {
  it("makes public reads from the snapshot only, exposing no private identities", async () => {
    m.snapshot.findUnique.mockResolvedValue({ totalViews: BigInt(123), countedPosts: 1, knownPosts: 2, refreshedAt: now, lockedBy: "private-worker", cursor: "private-post" });
    expect(await getPublicImpact()).toEqual({ totalViews: "123", countedPosts: 1, knownPosts: 2, refreshedAt: now.toISOString() });
    expect(m.fetchMetrics).not.toHaveBeenCalled(); expect(m.jobs.findMany).not.toHaveBeenCalled();
  });
  it("does no provider work if another instance has the lease or today is already complete", async () => {
    m.snapshot.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await refreshPublicImpactBatch(now)).toBe(false);
    expect(m.metrics.findMany).not.toHaveBeenCalled(); expect(m.fetchMetrics).not.toHaveBeenCalled();
    expect(m.snapshot.updateMany.mock.calls[0][0].where.AND[0].OR).toContainEqual({ day: { lt: day } });
  });
  it("discovers only completed owned-provider posts and deduplicates database records", async () => {
    m.snapshot.findUniqueOrThrow.mockResolvedValue({ day, phase: "discover", cursor: "cursor" });
    m.jobs.findMany.mockResolvedValue([{ id: "j1", connectedSocialAccountId: "a1", platform: "youtube", platformPostId: "p1", completedAt: now, createdAt: now }]);
    expect(await refreshPublicImpactBatch(now)).toBe(true);
    expect(m.jobs.findMany.mock.calls[0][0].where).toMatchObject({ status: "completed", platformPostId: { not: null }, connectedSocialAccount: { isActive: true }, id: { gt: "cursor" } });
    expect(m.metrics.createMany.mock.calls[0][0]).toMatchObject({ skipDuplicates: true, data: [{ platform: "youtube", platformPostId: "p1" }] });
    expect(m.snapshot.update.mock.calls[0][0].data).toMatchObject({ cursor: "j1", phase: "metrics" });
    expect(m.fetchMetrics).not.toHaveBeenCalled();
  });
  it("preserves the previous count on provider failure and records a real zero on success", async () => {
    m.metrics.findMany.mockResolvedValue(["failure", "zero"].map(id => ({ id, connectedSocialAccountId: "a", platform: "youtube", platformPostId: id, publishedAt: now, connectedSocialAccount: { grantedScopes: null } })));
    m.fetchMetrics.mockRejectedValueOnce(new Error("token=secret")); m.fetchMetrics.mockResolvedValueOnce({ views: 0 });
    await refreshPublicImpactBatch(now);
    expect(m.metrics.update.mock.calls.find(call => call[0].where.id === "failure")?.[0].data).toEqual({ attemptedAt: now });
    expect(m.metrics.update.mock.calls.find(call => call[0].where.id === "zero")?.[0].data).toMatchObject({ views: BigInt(0), attemptedAt: now });
    expect(m.fetchMetrics.mock.calls[0].at(-1)).toEqual({ viewsOnly: true });
  });
  it("publishes one completed sweep, summing latest lifetime counts rather than adding snapshots", async () => {
    await refreshPublicImpactBatch(now);
    expect(m.snapshot.update.mock.calls[0][0].data).toMatchObject({ phase: "complete", totalViews: BigInt(123), countedPosts: 1, knownPosts: 2 });
    expect(m.snapshot.updateMany.mock.calls.at(-1)?.[0]).toMatchObject({ data: { lockedBy: null, lockedUntil: null } });
  });
  it("restarts discovery on the next UTC day without resetting the visible total", async () => {
    m.snapshot.findUniqueOrThrow.mockResolvedValue({ day: new Date("2026-10-22"), phase: "complete", totalViews: BigInt(123) });
    m.snapshot.update.mockResolvedValue({ day, phase: "discover", cursor: null }); m.jobs.findMany.mockResolvedValue([]);
    await refreshPublicImpactBatch(now);
    expect(m.snapshot.update.mock.calls[0][0].data).toEqual({ day, phase: "discover", cursor: null });
    expect(m.metrics.aggregate).not.toHaveBeenCalled();
  });
});
