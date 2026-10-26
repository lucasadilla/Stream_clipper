import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ user: vi.fn(), canEdit: vi.fn(), refresh: vi.fn(), videos: { findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() }, transaction: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { landingFeaturedVideo: m.videos, $transaction: m.transaction } }));
vi.mock("@/services/landingFeaturedService", () => ({ canEditFeaturedShorts: m.canEdit, refreshFeaturedShorts: m.refresh }));
vi.mock("@/services/social/socialAccessService", async () => {
  class SessionAccessError extends Error { constructor(message: string, public status: number) { super(message); } }
  return { requireAuthUserId: m.user, SessionAccessError };
});
import { GET, PATCH, POST } from "@/app/api/landing/editor/route";
import { SessionAccessError } from "@/services/social/socialAccessService";
const request = (body: unknown, origin = "https://clipper.test", method = "PATCH") => new Request("https://clipper.test/api/landing/editor", { method, headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => { vi.resetAllMocks(); m.user.mockResolvedValue("owner"); m.canEdit.mockResolvedValue(true); m.transaction.mockImplementation(callback => callback({ landingFeaturedVideo: m.videos })); });
describe("featured catalog authorization and atomic pinning", () => {
  it("does not reveal catalog records to signed-out visitors", async () => {
    m.user.mockRejectedValue(new SessionAccessError("Sign in required", 401));
    expect((await GET(new Request("https://clipper.test/api/landing/editor"))).status).toBe(401);
    expect(m.videos.findMany).not.toHaveBeenCalled();
    expect(await (await GET(new Request("https://clipper.test/api/landing/editor?access=1"))).json()).toEqual({ canEdit: false });
  });
  it("blocks unrelated account owners from editing or refreshing", async () => {
    m.canEdit.mockResolvedValue(false);
    expect((await PATCH(request({ pins: [null, null, null] }))).status).toBe(403);
    expect((await POST(request({}, "https://clipper.test", "POST"))).status).toBe(403);
    expect(m.transaction).not.toHaveBeenCalled(); expect(m.refresh).not.toHaveBeenCalled();
  });
  it("rejects cross-site writes before resolving the owner", async () => {
    expect((await PATCH(request({ pins: [null, null, null] }, "https://unrelated.test"))).status).toBe(403);
    expect(m.user).not.toHaveBeenCalled();
  });
  it("does not clear existing pins when a chosen clip is unavailable", async () => {
    m.videos.findMany.mockResolvedValue([]);
    expect((await PATCH(request({ pins: ["abcdefghijk", null, null] }))).status).toBe(400);
    expect(m.videos.updateMany).not.toHaveBeenCalled();
  });
  it("replaces pins atomically while retaining automatic empty positions", async () => {
    m.videos.findMany.mockResolvedValue([{ id: "abcdefghijk" }]);
    const response = await PATCH(request({ pins: [null, "abcdefghijk", null] }));
    expect(response.status).toBe(200);
    expect(m.transaction.mock.calls[0][1]).toEqual({ isolationLevel: "Serializable" });
    expect(m.videos.findMany.mock.calls[0][0].where).toMatchObject({ eligible: true, available: true });
    expect(m.videos.update.mock.calls[0][0]).toEqual({ where: { id: "abcdefghijk" }, data: { pinSlot: 1 } });
  });
  it("unpins a clip when the owner removes it from automatic candidates", async () => {
    m.videos.findUnique.mockResolvedValue({ id: "abcdefghijk" });
    expect((await PATCH(request({ id: "abcdefghijk", eligible: false }))).status).toBe(200);
    expect(m.videos.update.mock.calls[0][0].data).toEqual({ eligible: false, pinSlot: null });
  });
});
