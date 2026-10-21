import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultPublishingPreferences } from "@/lib/social/preferences";
import { emptySocialContent } from "@/lib/social/types";
import { decryptSecret } from "@/lib/social/tokenCrypto";

const m = vi.hoisted(() => ({
  jobs: [] as Record<string, unknown>[], group: null as Record<string, unknown> | null,
  publish: vi.fn(), status: vi.fn(), validate: vi.fn(), context: vi.fn(), generated: vi.fn(), events: vi.fn(),
  createGroup: vi.fn(), media: vi.fn(), account: vi.fn(),
}));
function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === "OR") return (value as Record<string, unknown>[]).some((part) => matches(row, part));
    if (key === "publishGroup") return true;
    const current = row[key];
    if (value && typeof value === "object" && !(value instanceof Date)) {
      const condition = value as { in?: unknown[]; lte?: Date; lt?: Date; gt?: Date; not?: unknown };
      if (condition.in) return condition.in.includes(current);
      if (condition.lte) return current instanceof Date && current <= condition.lte;
      if (condition.lt) return current instanceof Date && current < condition.lt;
      if (condition.gt) return current instanceof Date && current > condition.gt;
      if ("not" in condition) return current !== condition.not;
    }
    return value instanceof Date ? current instanceof Date && current.getTime() === value.getTime() : current === value;
  });
}
function apply(row: Record<string, unknown>, data: Record<string, unknown>) {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === "object" && "increment" in value) row[key] = Number(row[key]) + Number((value as { increment: number }).increment);
    else if (value !== undefined) row[key] = structuredClone(value);
  }
  row.updatedAt = new Date();
}
vi.mock("@/lib/db", () => ({ prisma: {
  streamAutomationClip: { updateMany: vi.fn(async () => ({ count: 0 })) },
  socialPublishJob: {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => structuredClone(m.jobs.find((j) => j.id === where.id) || null)),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => structuredClone(m.jobs.find((j) => matches(j, where)) || null)),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => structuredClone(m.jobs.filter((j) => matches(j, where)))),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const rows = m.jobs.filter((j) => matches(j, where)); rows.forEach((j) => apply(j, data)); return { count: rows.length };
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => { const row = m.jobs.find((j) => j.id === where.id)!; apply(row, data); return structuredClone(row); }),
  },
  socialPublishGroup: {
    findFirst: vi.fn(async ({ where }: { where: { id: string; userId?: string } }) => m.group && m.group.id === where.id && (!where.userId || where.userId === m.group.userId) ? { ...structuredClone(m.group), jobs: structuredClone(m.jobs) } : null),
    findUnique: vi.fn(async () => structuredClone(m.group)),
    findUniqueOrThrow: vi.fn(async () => structuredClone(m.group)),
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { if (m.group) Object.assign(m.group, data); return m.group; }),
    create: (...args: unknown[]) => m.createGroup(...args),
  },
  connectedSocialAccount: { findFirst: (...args: unknown[]) => m.account(...args), findUnique: (...args: unknown[]) => m.account(...args), update: vi.fn() },
  socialPublishEvent: { create: (...args: unknown[]) => m.events(...args) },
  clipSuggestion: { findUnique: vi.fn(async () => ({ id: "clip", streamSessionId: "session", title: "A complete title", reason: "Context", startTimeSeconds: 0, endTimeSeconds: 30,
    streamSession: { title: "Source", channelTitle: "Creator", youtubeUrl: "https://youtube.com/watch?v=abcdefghijk" },
    platformExports: [], renderJobs: [{ id: "render", outputPath: "/video.mp4", params: {} }],
  })) },
  transcriptChunk: { findMany: vi.fn(async () => [{ text: "A complete transcript." }]) },
} }));
vi.mock("fs", () => ({ existsSync: vi.fn(() => true) }));
vi.mock("fs/promises", () => ({ stat: vi.fn(async () => ({ isFile: () => true, size: 512 })) }));
vi.mock("@/lib/ffmpeg", () => ({ probeMedia: (...args: unknown[]) => m.media(...args) }));
vi.mock("@/lib/storage", () => ({ resolveStoragePath: (value: string) => value }));
vi.mock("@/lib/social/capabilities", () => ({ canPublishPlatform: () => true, forcesPrivateUploads: () => false }));
vi.mock("@/services/social/socialContentGenerationService", () => ({ generateSocialContent: (...args: unknown[]) => m.generated(...args) }));
vi.mock("@/services/social/socialConnectionService", () => ({ getPublisherContext: (...args: unknown[]) => m.context(...args) }));
vi.mock("@/services/social/publishers", () => ({ getSocialPublisher: () => ({ publish: m.publish, getPublishStatus: m.status, validatePost: m.validate }) }));
vi.mock("@/services/social/socialPublishingPreferenceService", () => ({ getPublishingPreferences: async () => defaultPublishingPreferences() }));
vi.mock("@/lib/posthog-server", () => ({ getPostHogClient: () => ({ capture: vi.fn() }) }));
import { claimNextSocialPublishJob, createPublishGroup, enqueuePublishGroup, executeSocialPublishJob, reclaimStaleSocialPublishJobs, retryPublishJob, updatePublishJob } from "@/services/social/socialPublishingService";

function job(id = "job", platform = "youtube") {
  return { id, platform, publishGroupId: "group", connectedSocialAccountId: `account-${id}`, destinationId: "destination", status: "queued", attemptCount: 0, maxAttempts: 5, idempotencyKey: id,
    videoPath: "/video.mp4", platformExportId: null, platformUploadId: null, platformPostId: null, platformMediaId: null, platformPostUrl: null,
    editedContent: { ...emptySocialContent(platform as "youtube"), title: "A complete title" }, publishSettings: {}, validationWarnings: [],
    lockedAt: null, lockedBy: null, startedAt: null, completedAt: null, failedAt: null, errorCode: null, errorMessage: null, scheduledFor: null,
    createdAt: new Date(), updatedAt: new Date(), events: [], connectedSocialAccount: { id: `account-${id}`, displayName: "Creator", username: "creator", avatarUrl: null },
  };
}
beforeEach(() => {
  vi.clearAllMocks(); m.jobs = [job()]; m.group = { id: "group", userId: "user", clipSuggestionId: "clip", status: "publishing", scheduledFor: null, createdAt: new Date(), updatedAt: new Date() };
  m.publish.mockResolvedValue({ success: true, state: "published", platformPostId: "remote" });
  m.status.mockResolvedValue({ state: "processing" }); m.validate.mockResolvedValue({ ok: true, warnings: [] }); m.context.mockResolvedValue({ accessToken: "secret" });
  m.media.mockResolvedValue({ width: 1080, height: 1920, durationSeconds: 30, videoCodec: "h264" });
  m.generated.mockResolvedValue({ ...emptySocialContent("youtube"), title: "Generated once" });
  m.account.mockImplementation(async ({ where }: { where: { id: string } }) => ({ id: where.id, platformAccountId: "destination", isActive: true, connectionError: null }));
});

describe("durable social publishing worker", () => {
  it("checks an existing remote post instead of uploading a duplicate", async () => {
    m.jobs[0].platformPostId = "remote";
    const id = await claimNextSocialPublishJob(); await executeSocialPublishJob(id!);
    expect(m.publish).not.toHaveBeenCalled(); expect(m.validate).not.toHaveBeenCalled();
    expect(m.status).toHaveBeenCalledWith(expect.objectContaining({ destinationId: "destination" }), "remote");
    expect(m.jobs[0]).toMatchObject({ status: "processing", lockedBy: null });
    expect(m.jobs[0].scheduledFor).toBeInstanceOf(Date);
  });
  it("does not upload again after the platform rejects an existing remote post", async () => {
    m.jobs[0].platformPostId = "remote"; m.status.mockResolvedValue({ state: "failed", errorMessage: "Rejected by platform" });
    await executeSocialPublishJob((await claimNextSocialPublishJob())!);
    expect(m.jobs[0].status).toBe("failed"); expect(m.publish).not.toHaveBeenCalled();
  });
  it("does not spend upload attempts on processing polls", async () => {
    Object.assign(m.jobs[0], { status: "processing", scheduledFor: new Date(Date.now() - 1000), attemptCount: 5, platformPostId: "remote" });
    expect(await claimNextSocialPublishJob()).toBe("job"); expect(m.jobs[0].attemptCount).toBe(5);
    await executeSocialPublishJob("job"); expect(m.jobs[0].status).toBe("processing");
  });
  it("persists and encrypts upload checkpoints before continuing", async () => {
    m.publish.mockImplementation(async (_ctx, r) => {
      await r.checkpoint({ platformUploadId: "https://upload.example/session?private=token" });
      expect(String(m.jobs[0].platformUploadId)).toMatch(/^enc:/);
      expect(decryptSecret(String(m.jobs[0].platformUploadId).slice(4))).toContain("private=token");
      await r.checkpoint({ platformPostId: "remote" });
      return { success: true, state: "processing", platformPostId: "remote" };
    });
    await executeSocialPublishJob((await claimNextSocialPublishJob())!);
    expect(m.jobs[0]).toMatchObject({ status: "processing", platformPostId: "remote", lockedBy: null });
  });
  it("never blindly retries an uncertain irreversible post", async () => {
    m.publish.mockImplementation(async (_ctx, r) => { await r.checkpoint({ committing: true }); return { success: false, errorMessage: "Lost response" }; });
    await executeSocialPublishJob((await claimNextSocialPublishJob())!);
    expect(m.jobs[0]).toMatchObject({ status: "outcome_unknown", errorCode: "outcome_unknown" });
    await expect(retryPublishJob("user", "job")).rejects.toThrow(/only a failed/i);
  });
  it("reclaims an interrupted commit into review rather than creating a second post", async () => {
    Object.assign(m.jobs[0], { status: "uploading", lockedBy: "dead-worker", lockedAt: new Date(Date.now() - 10 * 60_000), errorCode: "commit_in_flight" });
    expect(await reclaimStaleSocialPublishJobs()).toBe(1);
    expect(m.jobs[0]).toMatchObject({ status: "outcome_unknown", lockedBy: null });
  });
  it("refuses a duplicate active retry and an edit to an active upload", async () => {
    m.jobs[0].status = "uploading";
    await expect(retryPublishJob("user", "job")).rejects.toThrow(/only a failed/i);
    await expect(updatePublishJob("user", "job", { publishSettings: { privacy: "public" } })).rejects.toThrow(/cannot edit/i);
  });
  it("does not execute a job owned by a different worker", async () => {
    Object.assign(m.jobs[0], { status: "preparing_media", lockedBy: "other-worker" });
    await executeSocialPublishJob("job"); expect(m.publish).not.toHaveBeenCalled();
  });
  it("keeps TikTok in review while Autopilot queues the supported destinations", async () => {
    m.jobs = [ { ...job("youtube"), status: "draft" }, { ...job("tiktok", "tiktok"), status: "awaiting_consent" } ];
    await enqueuePublishGroup({ userId: "user", groupId: "group", mode: "now", source: "autopilot" });
    expect(m.jobs.map((row) => row.status)).toEqual(["queued", "awaiting_consent"]);
  });
  it("requires explicit per-post TikTok consent even through the API", async () => {
    m.jobs = [{ ...job("tiktok", "tiktok"), status: "awaiting_consent" }];
    await expect(enqueuePublishGroup({ userId: "user", groupId: "group", mode: "now" })).rejects.toThrow(/review and confirm/i);
    expect(m.jobs[0].status).toBe("awaiting_consent");
  });
  it("rejects invalid schedule dates without changing jobs", async () => {
    m.jobs[0].status = "draft";
    await expect(enqueuePublishGroup({ userId: "user", groupId: "group", mode: "schedule", scheduledFor: new Date("invalid") })).rejects.toThrow(/future time/i);
    expect(m.jobs[0].status).toBe("draft");
  });
  it("reuses an idempotent request before generating any more copy", async () => {
    const options = { userId: "user", clipSuggestionId: "clip", requestKey: "same-request", destinations: [{ connectedSocialAccountId: "account", platform: "youtube" as const }] };
    m.createGroup.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => { m.group = { ...data, createdAt: new Date(), updatedAt: new Date(), scheduledFor: null }; m.jobs = []; return m.group; });
    const first = await createPublishGroup(options); const second = await createPublishGroup(options);
    expect(first?.id).toBe(second?.id); expect(m.createGroup).toHaveBeenCalledTimes(1); expect(m.generated).toHaveBeenCalledTimes(1);
  });
  it("generates copy once when several accounts target the same platform", async () => {
    m.createGroup.mockResolvedValue({ id: "created" });
    await createPublishGroup({ userId: "user", clipSuggestionId: "clip", destinations: ["one", "two"].map((id) => ({ connectedSocialAccountId: id, platform: "youtube" as const })) });
    expect(m.generated).toHaveBeenCalledTimes(1);
    const jobs = m.createGroup.mock.calls[0][0].data.jobs.create;
    expect(jobs).toHaveLength(2); expect(jobs[0].idempotencyKey).not.toBe(jobs[1].idempotencyKey);
  });
});
