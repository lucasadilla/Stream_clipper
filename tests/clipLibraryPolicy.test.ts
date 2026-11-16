import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ find: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { clipLibraryItem: { findUnique: m.find, updateMany: m.update } } }));
import { libraryEditSchema, libraryStatus, sameOriginLibraryWrite } from "@/lib/clipLibrary";
import { withActiveLibraryClip } from "@/services/clipLibraryLeaseService";
beforeEach(() => { vi.resetAllMocks(); });
describe("library policy", () => {
  it("shows partial publishing failures instead of hiding them behind a successful post", () => {
    expect(libraryStatus([{ status: "completed" }, { status: "failed" }], true)).toBe("failed");
    expect(libraryStatus([{ status: "completed" }, { status: "scheduled" }], true)).toBe("scheduled");
    expect(libraryStatus([], false)).toBe("unavailable"); expect(libraryStatus([], true)).toBe("draft");
  });
  it("validates editable metadata without accepting filesystem fields", () => {
    expect(libraryEditSchema.safeParse({ title: " ", postingCaption: null }).success).toBe(false);
    expect(libraryEditSchema.safeParse({ title: "Saved", postingCaption: "My caption", outputPath: "other-file" }).success).toBe(false);
    expect(libraryEditSchema.parse({ title: " My title ", postingCaption: null }).title).toBe("My title");
  });
  it("rejects cross-site library writes", () => {
    const request = new Request("https://clipper.test/api/library/clip", { headers: { origin: "https://unrelated.test", "content-type": "application/json" } });
    expect(sameOriginLibraryWrite(request)).toBe(false);
  });
  it("prevents a clip in Trash from being queued for posting", async () => {
    m.find.mockResolvedValue({ id: "clip", deletedAt: new Date(), purgedAt: null });
    const publish = vi.fn(); await expect(withActiveLibraryClip("clip", publish)).rejects.toThrow("Restore this clip");
    expect(publish).not.toHaveBeenCalled();
  });
  it("serializes a publishing transition against saving or deletion and releases the lease on failure", async () => {
    m.find.mockResolvedValue({ id: "clip", deletedAt: null, purgedAt: null }); m.update.mockResolvedValue({ count: 0 });
    const publish = vi.fn(); await expect(withActiveLibraryClip("clip", publish)).rejects.toThrow("being saved"); expect(publish).not.toHaveBeenCalled();
    m.update.mockResolvedValue({ count: 1 });
    await expect(withActiveLibraryClip("clip", async () => { throw new Error("Platform rejected"); })).rejects.toThrow("Platform rejected");
    expect(m.update.mock.calls.at(-1)?.[0].data).toEqual({ lockedBy: null, lockedUntil: null });
  });
});
