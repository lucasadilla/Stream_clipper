import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ row: null as null | Record<string, unknown>, findFirst: vi.fn(), updateMany: vi.fn(), stat: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { showcaseClip: { findUnique: async () => m.row, findFirst: m.findFirst, updateMany: m.updateMany } } }));
vi.mock("fs/promises", () => ({ stat: m.stat, copyFile: vi.fn(), mkdir: vi.fn(), readdir: vi.fn(), unlink: vi.fn() }));
vi.mock("@/lib/ffmpeg", () => ({ extractFastTimelineFrame: vi.fn(), probeMedia: vi.fn() }));
vi.mock("@/lib/storage", () => ({ getStorageRoot: () => "/storage", getUploadDir: vi.fn(), resolveStoragePath: (file: string) => `/storage/${file}`, toRelativeStoragePath: vi.fn() }));
vi.mock("@/services/social/socialAccessService", () => ({ SessionAccessError: class extends Error { constructor(message: string, public status: number) { super(message); } } }));
import { getShowcaseMedia, manageShowcase } from "@/services/showcaseService";
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("SHOWCASE_ADMIN_USER_IDS", "reviewer"); m.row = { id: "clip", userId: "owner", status: "pending", consentAt: new Date(), approvedAt: null, videoPath: "showcase/clip.mp4", posterPath: "showcase/poster.jpg" }; m.updateMany.mockResolvedValue({ count: 1 }); });
describe("showcase access", () => {
  it("keeps pending copies private while allowing the creator and configured reviewer to inspect them", async () => {
    expect(await getShowcaseMedia("clip", "video")).toBeNull();
    expect(await getShowcaseMedia("clip", "video", "stranger")).toBeNull();
    expect(await getShowcaseMedia("clip", "video", "owner")).toBe("showcase/clip.mp4");
    expect(await getShowcaseMedia("clip", "video", "reviewer")).toBe("showcase/clip.mp4");
  });
  it("denies the very next public request after consent is withdrawn", async () => {
    m.row = { ...m.row, status: "approved", approvedAt: new Date() };
    expect(await getShowcaseMedia("clip", "video")).toBe("showcase/clip.mp4");
    m.row = { ...m.row, status: "withdrawn", consentAt: null };
    expect(await getShowcaseMedia("clip", "video")).toBeNull();
    expect(await getShowcaseMedia("clip", "../../private")).toBeNull();
  });
  it("does not let a creator approve their own submission", async () => {
    await expect(manageShowcase("owner", "clip", "approve")).rejects.toThrow(/restricted/);
    expect(m.updateMany).not.toHaveBeenCalled();
  });
  it("checks ownership for withdrawal and uses a version guard against concurrent approval", async () => {
    const version = new Date(); m.findFirst.mockResolvedValue({ ...m.row, updatedAt: version });
    await manageShowcase("owner", "clip", "withdraw");
    expect(m.findFirst).toHaveBeenCalledWith({ where: { id: "clip", userId: "owner" } });
    expect(m.updateMany.mock.calls[0][0]).toMatchObject({ where: { userId: "owner", updatedAt: version, status: "pending" }, data: { status: "withdrawn", consentAt: null, approvedAt: null } });
  });
});
