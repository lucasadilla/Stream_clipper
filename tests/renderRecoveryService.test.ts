import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ rows: vi.fn(), update: vi.fn(), log: vi.fn(), exists: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { renderJob: { findMany: m.rows, updateMany: m.update } } }));
vi.mock("@/lib/renderJobLogs", () => ({ appendRenderJobLog: m.log }));
vi.mock("@/lib/storage", () => ({ fileExists: m.exists }));
import { reclaimStaleRenderJobs } from "@/services/renderRecoveryService";
import { findCompletedRenderForSpec } from "@/services/completedRenderReuseService";
beforeEach(() => { vi.clearAllMocks(); });
describe("durable render recovery", () => {
  it("does not reclaim a worker that refreshed its heartbeat after the stale query", async () => {
    m.rows.mockResolvedValue([{ id: "job", attempts: 1, maxAttempts: 3 }]); m.update.mockResolvedValue({ count: 0 });
    expect(await reclaimStaleRenderJobs()).toBe(0); expect(m.log).not.toHaveBeenCalled();
    expect(m.update.mock.calls[0][0].where).toMatchObject({ id: "job", status: "processing", OR: expect.any(Array) });
  });
  it("requeues interrupted work without deleting source, edits or completed exports", async () => {
    m.rows.mockResolvedValue([{ id: "job", attempts: 1, maxAttempts: 3 }]); m.update.mockResolvedValue({ count: 1 });
    expect(await reclaimStaleRenderJobs()).toBe(1);
    expect(m.update.mock.calls[0][0].data).toEqual({ status: "queued", lockedAt: null, lockedBy: null, errorMessage: null });
  });
  it("surfaces exhausted work instead of retrying forever", async () => {
    m.rows.mockResolvedValue([{ id: "job", attempts: 3, maxAttempts: 3 }]); m.update.mockResolvedValue({ count: 1 });
    await reclaimStaleRenderJobs(); expect(m.update.mock.calls[0][0].data.status).toBe("failed");
  });
  it("reuses only an identical completed request whose actual file still exists", async () => {
    m.rows.mockResolvedValue([{ id: "missing", outputPath: "missing.mp4" }, { id: "ready", outputPath: "ready.mp4" }]); m.exists.mockImplementation(path => path === "ready.mp4");
    expect(await findCompletedRenderForSpec("session", "clip", "hash")).toBe("ready");
    expect(m.rows.mock.calls[0][0].where).toMatchObject({ streamSessionId: "session", clipSuggestionId: "clip", status: "completed", params: { path: ["renderSpecHash"], equals: "hash" } });
    m.exists.mockReturnValue(false); expect(await findCompletedRenderForSpec("session", "clip", "hash")).toBeNull();
  });
});
