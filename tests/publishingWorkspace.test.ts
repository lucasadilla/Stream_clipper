import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptySocialContent } from "@/lib/social/types";
const m = vi.hoisted(() => ({ jobs: [] as Record<string, unknown>[], events: vi.fn(), update: vi.fn(), list: vi.fn(), prefs: vi.fn(), savePrefs: vi.fn(), pause: vi.fn(), media: vi.fn() }));
const owned = (where: Record<string, unknown>) => (where.publishGroup as { userId?: string } | undefined)?.userId === "owner";
vi.mock("fs", () => ({ existsSync: () => true }));
vi.mock("@/lib/db", () => { const db = {
  socialPublishJob: {
    findFirst: vi.fn(async ({ where }) => owned(where) ? m.jobs.find((job) => job.id === where.id) || null : null),
    findMany: (...args: unknown[]) => m.list(...args),
    updateMany: (...args: unknown[]) => m.update(...args),
  },
  socialPublishEvent: { create: m.events }, socialPublishGroup: { update: vi.fn() },
  clipSuggestion: { findMany: vi.fn(async () => [{ id: "clip", title: "Original clip" }]) },
  streamAutomation: { updateMany: m.pause },
}; return { prisma: { ...db, $transaction: async (work: (value: typeof db) => unknown) => work(db) } }; });
vi.mock("@/services/social/socialPublishingService", () => ({ inspectPublishMedia: (...args: unknown[]) => m.media(...args) }));
vi.mock("@/services/social/socialConnectionService", () => ({ getPublisherContext: async () => ({ accessToken: "secret" }) }));
vi.mock("@/services/social/publishers", () => ({ getSocialPublisher: () => ({ validatePost: async () => ({ ok: true, warnings: [] }) }) }));
vi.mock("@/services/social/publishingControlService", () => ({ setPublishingPaused: m.savePrefs }));
vi.mock("@/services/social/socialPublishingPreferenceService", () => ({ getPublishingPreferences: m.prefs, upsertPublishingPreferences: m.savePrefs }));
vi.mock("@/lib/social/capabilities", () => ({ forcesPrivateUploads: () => true, canPublishPlatform: () => true, getPlatformCapability: () => "private_test_only" }));
import { approvePublishingPosts, changePublishingPost, listPublishingPosts, pausePublishing } from "@/services/social/publishingWorkspaceService";
import { calendarRange, futureSchedule } from "@/lib/social/workspace";
function job(id: string, platform = "youtube") {
  return { id, publishGroupId: "group", connectedSocialAccountId: "account", platform, destinationId: "channel", idempotencyKey: id,
    status: "draft", lockedBy: null, platformPostId: null, videoPath: "/finished.mp4", platformExportId: "export",
    updatedAt: new Date("2026-01-01"), createdAt: new Date("2026-01-01"), completedAt: null, scheduledFor: null,
    generatedContent: { ...emptySocialContent(platform as "youtube"), title: "A complete meaningful clip title", caption: "Description" },
    publishSettings: { privacy: "public" }, publishGroup: { id: "group", clipSuggestionId: "clip" },
    connectedSocialAccount: { id: "account", username: "creator", displayName: "Creator", isActive: true }, platformPostUrl: null, errorMessage: null };
}
const selected = (id: string) => ({ id, version: "2026-01-01T00:00:00.000Z" });
beforeEach(() => {
  vi.clearAllMocks(); m.jobs = [job("one"), job("two")]; m.prefs.mockResolvedValue({ publishingPaused: false });
  m.media.mockResolvedValue({ filePath: "/finished.mp4", mimeType: "video/mp4", fileSizeBytes: 1024, durationSeconds: 30, width: 1080, height: 1920 });
  m.list.mockImplementation(async ({ where }) => where.publishGroupId ? m.jobs : owned(where) ? m.jobs : []);
  m.update.mockImplementation(async ({ where, data }) => { const row = m.jobs.find((entry) => entry.id === where.id);
    if (!row || !owned(where) || row.lockedBy || (row.updatedAt as Date).getTime() !== where.updatedAt.getTime()) return { count: 0 };
    Object.assign(row, data, { updatedAt: new Date() }); return { count: 1 };
  });
});
describe("review inbox and calendar", () => {
  it("approves only selected destinations and preserves the exact finished export", async () => {
    expect(await approvePublishingPosts("owner", { jobs: [selected("one")] })).toEqual({ results: [{ id: "one", ok: true }] });
    expect(m.jobs[0]).toMatchObject({ status: "queued", videoPath: "/finished.mp4", platformExportId: "export", publishSettings: { privacy: "private" } });
    expect(m.jobs[1].status).toBe("draft"); expect(m.events).toHaveBeenCalledOnce();
  });
  it("does not approve a stale edit, another user's job, or a missing video", async () => {
    m.jobs[0].updatedAt = new Date();
    expect((await approvePublishingPosts("owner", { jobs: [selected("one")] })).results[0].ok).toBe(false);
    expect((await approvePublishingPosts("other", { jobs: [selected("two")] })).results[0].ok).toBe(false);
    m.jobs[1].videoPath = null;
    expect((await approvePublishingPosts("owner", { jobs: [selected("two")] })).results[0].ok).toBe(false);
    expect(m.update).not.toHaveBeenCalled();
  });
  it("requires TikTok's individual consent and saved music/visibility settings", async () => {
    m.jobs = [job("tik", "tiktok")];
    expect((await approvePublishingPosts("owner", { jobs: [selected("tik")] })).results[0].ok).toBe(false);
    expect((await approvePublishingPosts("owner", { jobs: [{ ...selected("tik"), tiktokConsent: true }] })).results[0].ok).toBe(false);
    m.jobs[0].publishSettings = { musicUsageConfirmed: true, tiktokPrivacyLevel: "SELF_ONLY" };
    expect((await approvePublishingPosts("owner", { jobs: [{ ...selected("tik"), tiktokConsent: true }] })).results[0].ok).toBe(true);
  });
  it("reports partial success rather than silently approving a failed sibling", async () => {
    m.jobs[1].status = "uploading";
    const result = await approvePublishingPosts("owner", { jobs: [selected("one"), selected("two")] });
    expect(result.results.map((row) => row.ok)).toEqual([true, false]); expect(m.jobs[1].status).toBe("uploading");
  });
  it("uses a compare-and-swap after validation and rejects a concurrent change", async () => {
    m.update.mockResolvedValue({ count: 0 });
    expect((await approvePublishingPosts("owner", { jobs: [selected("one")] })).results[0]).toMatchObject({ ok: false });
    expect(m.events).not.toHaveBeenCalled();
  });
  it("reschedules only approved jobs and returns queued posts to review", async () => {
    await expect(changePublishingPost("owner", "one", { action: "reschedule", version: selected("one").version, scheduledFor: new Date(Date.now() + 86400000).toISOString() })).rejects.toThrow(/Approve/);
    m.jobs[0].status = "scheduled";
    await changePublishingPost("owner", "one", { action: "hold", version: selected("one").version });
    expect(m.jobs[0]).toMatchObject({ status: "draft", scheduledFor: null, publishSettings: { postConsent: false } });
  });
  it("cannot change a job after the upload lease is acquired", async () => {
    m.jobs[0].status = "queued"; m.jobs[0].lockedBy = "worker";
    await expect(changePublishingPost("owner", "one", { action: "cancel", version: selected("one").version })).rejects.toThrow(/already started/);
    expect(m.update).not.toHaveBeenCalled();
  });
  it("keeps list queries owned and exposes preview URLs without storage paths", async () => {
    const result = await listPublishingPosts("owner", { view: "inbox" });
    expect(result.posts[0]).toMatchObject({ previewUrl: "/api/social/publish-jobs/one/preview", version: selected("one").version });
    expect(JSON.stringify(result)).not.toContain("/finished.mp4"); expect(JSON.stringify(result)).not.toContain("secret");
    expect(m.list.mock.calls[0][0].where.publishGroup).toEqual({ userId: "owner" });
  });
  it("pauses both new publishing and Autopilot, and resume doesn't restart Autopilot", async () => {
    await pausePublishing("owner", true); expect(m.savePrefs).toHaveBeenCalledWith("owner", true);
    expect(m.pause).toHaveBeenCalledWith({ where: { userId: "owner" }, data: { enabled: false, autoPublishEnabled: false } });
    m.pause.mockClear(); await pausePublishing("owner", false); expect(m.pause).not.toHaveBeenCalled();
    m.prefs.mockResolvedValue({ publishingPaused: true }); await expect(approvePublishingPosts("owner", { jobs: [selected("one")] })).rejects.toThrow(/paused/);
  });
  it("rejects invalid calendar ranges, duplicate selections, and past schedules", async () => {
    expect(() => calendarRange("bad", "bad")).toThrow(); expect(() => calendarRange("2026-01-01", "2027-01-01")).toThrow();
    expect(() => futureSchedule("2020-01-01")).toThrow();
    await expect(approvePublishingPosts("owner", { jobs: [selected("one"), selected("one")] })).rejects.toThrow();
  });
});
