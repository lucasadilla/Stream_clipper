import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
const identity = vi.hoisted(() => ({ userId: "" }));
vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: identity.userId } }) }));

const database = process.env.CLIP_LIBRARY_TEST_DATABASE_URL ?? "";
const enabled = /^postgresql:\/\/cliptest@127\.0\.0\.1:55439\/clip_library_qa$/.test(database);
describe.skipIf(!enabled)("permanent clip library with PostgreSQL and real video files", () => {
  let prisma: typeof import("@/lib/db")["prisma"];
  let archive: typeof import("@/services/clipLibraryArchiveService");
  let cleanup: typeof import("@/services/sessionCleanupService");
  let library: typeof import("@/services/clipLibraryService");
  let files: typeof import("@/app/api/library/[id]/assets/[assetId]/route");
  let mutations: typeof import("@/app/api/library/[id]/route");
  let leases: typeof import("@/services/clipLibraryLeaseService");
  let root: string;
  let owner: { id: string; userId: string | null };
  let other: { id: string; userId: string | null };
  const users: string[] = [];
  let source: string;
  const request = () => new Request("http://clipper.test/api/library");
  beforeAll(async () => {
    vi.stubEnv("DATABASE_URL", database); vi.stubEnv("DIRECT_URL", database);
    root = await fs.mkdtemp(path.resolve(process.cwd(), "../outputs/clip-library/integration-storage-"));
    vi.stubEnv("STORAGE_ROOT", root);
    source = path.join(root, "fixture.mp4");
    const { getFfmpegPath } = await import("@/lib/ffmpeg");
    await promisify(execFile)(getFfmpegPath(), ["-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24", "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", source], { timeout: 20_000, windowsHide: true });
    ({ prisma } = await import("@/lib/db"));
    archive = await import("@/services/clipLibraryArchiveService"); cleanup = await import("@/services/sessionCleanupService");
    library = await import("@/services/clipLibraryService"); files = await import("@/app/api/library/[id]/assets/[assetId]/route");
    mutations = await import("@/app/api/library/[id]/route"); leases = await import("@/services/clipLibraryLeaseService");
    for (const role of ["owner", "other"]) {
      const user = await prisma.user.create({ data: { email: `library-${role}-${randomUUID()}@example.invalid`, name: role } }); users.push(user.id);
      const billing = await prisma.billingAccount.create({ data: { userId: user.id, stripeCustomerId: `qa_${randomUUID()}`, plan: "creator", status: "active" } });
      if (role === "owner") owner = billing; else other = billing;
    }
    identity.userId = owner.userId!;
  }, 30_000);
  afterAll(async () => {
    if (prisma && users.length) {
      const accounts = await prisma.billingAccount.findMany({ where: { userId: { in: users } }, select: { id: true } });
      await prisma.clipLibraryItem.deleteMany({ where: { billingAccountId: { in: accounts.map(row => row.id) } } });
      await prisma.streamSession.deleteMany({ where: { billingAccountId: { in: accounts.map(row => row.id) } } });
      await prisma.billingAccount.deleteMany({ where: { id: { in: accounts.map(row => row.id) } } });
      await prisma.user.deleteMany({ where: { id: { in: users } } }); await prisma.$disconnect();
    }
    if (root && path.basename(root).startsWith("integration-storage-")) await fs.rm(root, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });
  async function fixture(manual = false) {
    identity.userId = owner.userId!;
    const session = await prisma.streamSession.create({ data: { billingAccountId: owner.id, youtubeVideoId: "abcdefghijk", youtubeUrl: "https://www.youtube.com/watch?v=abcdefghijk", title: "Library test source", liveStatus: "none" } });
    const clip = manual ? null : await prisma.clipSuggestion.create({ data: { streamSessionId: session.id, title: "A saved moment", reason: "", startTimeSeconds: 0, endTimeSeconds: 5 } });
    const dir = path.join(root, "renders", session.id); await fs.mkdir(dir, { recursive: true });
    const output = path.join(dir, "finished.mp4"); await fs.copyFile(source, output);
    const relative = path.relative(root, output).replaceAll("\\", "/");
    const render = await prisma.renderJob.create({ data: { streamSessionId: session.id, clipSuggestionId: clip?.id, status: "completed", outputPath: relative, includeCaptions: false,
      params: { startTimeSeconds: 0, endTimeSeconds: 5, streamSessionId: session.id, preview: false }, completedAt: new Date() } });
    await prisma.sourceMedia.create({ data: { streamSessionId: session.id, originalFilename: "source.mp4", filePath: relative, mimeType: "video/mp4", sizeBytes: BigInt((await fs.stat(output)).size) } });
    return { session, clip, render, output, relative };
  }
  it("survives workspace replacement and retention with exactly the original video bytes", async () => {
    const sample = await fixture(); const original = await fs.readFile(sample.output);
    await archive.archiveCompletedRender(sample.render.id);
    const next = await prisma.streamSession.create({ data: { billingAccountId: owner.id, youtubeVideoId: "newsourceid", youtubeUrl: "https://www.youtube.com/watch?v=newsourceid", title: "Next workspace" } });
    await cleanup.replacePriorSessionsForAccount(owner.id, next.id);
    await expect(fs.stat(sample.output)).rejects.toMatchObject({ code: "ENOENT" });
    const saved = await prisma.clipLibraryAsset.findUniqueOrThrow({ where: { originKind_originId: { originKind: "render", originId: sample.render.id } } });
    expect(await fs.readFile(path.join(root, saved.outputPath!))).toEqual(original);
    expect((await prisma.sourceMedia.findFirstOrThrow({ where: { streamSessionId: sample.session.id } })).sizeBytes).toBe(BigInt(0));
    await cleanup.deleteStreamSession(sample.session.id);
    expect(await prisma.clipSuggestion.findUnique({ where: { id: sample.clip!.id } })).not.toBeNull();
    expect(await fs.readFile(path.join(root, saved.outputPath!))).toEqual(original);
  }, 30_000);
  it("serves private authenticated range downloads and rejects a different owner", async () => {
    const sample = await fixture(); await archive.archiveCompletedRender(sample.render.id);
    const item = await library.getLibraryItem(request(), sample.clip!.id); const asset = item.assets[0];
    const context = { params: Promise.resolve({ id: item.id, assetId: asset.id }) };
    const response = await files.GET(new Request(`http://clipper.test${asset.videoUrl}`, { headers: { range: "bytes=0-127" } }), context);
    expect(response.status).toBe(206); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(Buffer.from(await response.arrayBuffer())).toEqual((await fs.readFile(source)).subarray(0, 128));
    const head = await files.HEAD(new Request(`http://clipper.test${asset.downloadUrl}`, { method: "HEAD" }), context);
    expect(head.status).toBe(200); expect(head.headers.get("content-disposition")).toContain("attachment");
    expect(Number(head.headers.get("content-length"))).toBe((await fs.stat(source)).size);
    identity.userId = other.userId!;
    expect((await library.listLibrary(request())).items).toHaveLength(0);
    expect((await files.GET(new Request(`http://clipper.test${asset.videoUrl}`), context)).status).toBe(404);
    identity.userId = owner.userId!;
  }, 30_000);
  it("keeps every saved platform variant separately and preserves their actual caption settings", async () => {
    const sample = await fixture(); await archive.archiveCompletedRender(sample.render.id);
    const pack = await prisma.platformExportPack.create({ data: { clipSuggestionId: sample.clip!.id, streamSessionId: sample.session.id, name: "Test versions" } });
    const output = await prisma.platformExport.create({ data: { exportPackId: pack.id, clipSuggestionId: sample.clip!.id, streamSessionId: sample.session.id,
      platform: "x", presetName: "X", status: "completed", outputPath: sample.relative, exportSettings: { burnSubtitles: false, includeCaptions: true } } });
    await archive.archiveCompletedPlatformExport(output.id); await cleanup.retireStreamSession(sample.session.id);
    const item = await library.getLibraryItem(request(), sample.clip!.id);
    expect(item.assets.map(asset => asset.platform).sort()).toEqual(["general", "x"]);
    expect(item.assets.every(asset => asset.captions === false && asset.status === "ready")).toBe(true);
    for (const asset of item.assets) expect(asset.downloadUrl).toContain(`/api/library/${item.id}/assets/`);
    const { resolvePublishMedia } = await import("@/services/social/socialPublishingService");
    const media = await resolvePublishMedia({ clipSuggestionId: item.id, platform: "x", platformExportId: output.id });
    expect(await fs.readFile(media.filePath)).toEqual(await fs.readFile(source));
    expect(media.platformExportId).toBe(output.id);
    await expect(resolvePublishMedia({ clipSuggestionId: item.id, platform: "youtube", youtubeFormat: "shorts", platformExportId: output.id })).rejects.toThrow("format was not saved");
    await expect(resolvePublishMedia({ clipSuggestionId: item.id, platform: "youtube", youtubeFormat: "shorts" })).rejects.toThrow("format was not saved");
  }, 30_000);
  it("defers cleanup while an encode is in flight", async () => {
    const sample = await fixture(); await prisma.renderJob.update({ where: { id: sample.render.id }, data: { status: "processing" } });
    await expect(cleanup.retireStreamSession(sample.session.id)).rejects.toThrow("exports finish");
    expect((await fs.stat(sample.output)).size).toBeGreaterThan(0);
    await prisma.renderJob.update({ where: { id: sample.render.id }, data: { status: "completed" } });
  });
  it("supports restore and permanent deletion without resurrecting deleted clips on backfill", async () => {
    const sample = await fixture(); await archive.archiveCompletedRender(sample.render.id);
    const saved = await prisma.clipLibraryAsset.findFirstOrThrow({ where: { itemId: sample.clip!.id } });
    await library.trashLibraryItem(request(), sample.clip!.id);
    expect((await library.listLibrary(new Request("http://clipper.test/api/library?trash=1&q=no-match&platform=invalid&days=7"))).items.some(item => item.id === sample.clip!.id)).toBe(true);
    await expect(leases.withActiveLibraryClip(sample.clip!.id, async () => true)).rejects.toThrow("Restore");
    await library.trashLibraryItem(request(), sample.clip!.id, true);
    expect((await library.getLibraryItem(request(), sample.clip!.id)).assets[0].status).toBe("ready");
    await library.trashLibraryItem(request(), sample.clip!.id); await archive.purgeLibraryItem(sample.clip!.id, owner.id);
    await expect(fs.stat(path.join(root, saved.outputPath!))).rejects.toMatchObject({ code: "ENOENT" });
    await archive.archiveCompletedRender(sample.render.id);
    expect((await prisma.clipLibraryItem.findUniqueOrThrow({ where: { id: sample.clip!.id } })).purgedAt).not.toBeNull();
    expect((await library.listLibrary(request())).items.some(item => item.id === sample.clip!.id)).toBe(false);
  }, 30_000);
  it("blocks Trash when a scheduled post still depends on the video", async () => {
    const sample = await fixture(); await archive.archiveCompletedRender(sample.render.id);
    const account = await prisma.connectedSocialAccount.create({ data: { userId: owner.userId!, platform: "youtube", platformAccountId: randomUUID(), encryptedAccessToken: "local-test-only" } });
    const group = await prisma.socialPublishGroup.create({ data: { userId: owner.userId!, clipSuggestionId: sample.clip!.id, libraryItemId: sample.clip!.id,
      jobs: { create: { connectedSocialAccountId: account.id, platform: "youtube", status: "scheduled", idempotencyKey: randomUUID() } } }, include: { jobs: true } });
    await expect(library.trashLibraryItem(request(), sample.clip!.id)).rejects.toThrow("Cancel scheduled");
    await prisma.socialPublishJob.update({ where: { id: group.jobs[0].id }, data: { status: "cancelled" } });
    await library.trashLibraryItem(request(), sample.clip!.id);
  }, 30_000);
  it("archives manual timeline cuts with a stable publishable clip identity", async () => {
    const sample = await fixture(true); await archive.archiveCompletedRender(sample.render.id);
    const render = await prisma.renderJob.findUniqueOrThrow({ where: { id: sample.render.id } });
    expect(render.clipSuggestionId).toBe(`saved_${render.id}`); expect(render.libraryState).toBe("saved");
    expect((await library.getLibraryItem(request(), render.clipSuggestionId!)).publishUrl).toContain("library=1");
  }, 30_000);
  it("does not save low-resolution previews as finished library clips", async () => {
    const sample = await fixture();
    await prisma.renderJob.update({ where: { id: sample.render.id }, data: { params: { preview: true } } });
    await archive.archiveCompletedRender(sample.render.id);
    expect(await prisma.clipLibraryItem.findUnique({ where: { id: sample.clip!.id } })).toBeNull();
    expect((await prisma.renderJob.findUniqueOrThrow({ where: { id: sample.render.id } })).libraryState).toBe("ignored");
  });
  it("keeps saved downloads available after a subscription ends while requiring a plan for posting", async () => {
    const sample = await fixture(); await archive.archiveCompletedRender(sample.render.id); await cleanup.retireStreamSession(sample.session.id);
    const { requireClipAccessForUser } = await import("@/services/social/socialAccessService");
    await expect(requireClipAccessForUser(request(), sample.clip!.id)).resolves.toBeTruthy();
    await prisma.billingAccount.update({ where: { id: owner.id }, data: { status: "canceled" } });
    try {
      expect((await library.getLibraryItem(request(), sample.clip!.id)).assets[0].downloadUrl).toBeTruthy();
      await expect(requireClipAccessForUser(request(), sample.clip!.id)).rejects.toMatchObject({ status: 402 });
    } finally { await prisma.billingAccount.update({ where: { id: owner.id }, data: { status: "active" } }); }
  }, 30_000);
  it("retains edit metadata and rejects unsafe or cross-site changes", async () => {
    const sample = await fixture(); await archive.archiveCompletedRender(sample.render.id);
    const context = { params: Promise.resolve({ id: sample.clip!.id }) };
    const update = (origin: string, body: unknown) => new Request(`http://clipper.test/api/library/${sample.clip!.id}`, { method: "PATCH", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
    expect((await mutations.PATCH(update("https://other.test", { title: "Changed", postingCaption: "No" }), context)).status).toBe(403);
    expect((await mutations.PATCH(update("http://clipper.test", { title: "My finished clip", postingCaption: "A caption I chose." }), context)).status).toBe(200);
    await archive.archiveCompletedRender(sample.render.id);
    expect((await library.getLibraryItem(request(), sample.clip!.id)).title).toBe("My finished clip");
    expect((await prisma.clipSuggestion.findUniqueOrThrow({ where: { id: sample.clip!.id } })).title).toBe("My finished clip");
  }, 30_000);
});
