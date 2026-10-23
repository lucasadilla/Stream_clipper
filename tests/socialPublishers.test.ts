import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import type { PublishRequest } from "@/lib/social/SocialPublisher";
import { emptySocialContent } from "@/lib/social/types";
import { youtubePublisher } from "@/services/social/publishers/youtubePublisher";
import { xPublisher } from "@/services/social/publishers/xPublisher";
import { instagramPublisher } from "@/services/social/publishers/instagramPublisher";
import { facebookPublisher } from "@/services/social/publishers/facebookPublisher";
import { tiktokPublisher } from "@/services/social/publishers/tiktokPublisher";

const http = vi.fn();
let folder: string;
let file: string;
const ctx = { accessToken: "test-token", destinationId: "1234", accountMetadata: { username: "creator" } };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
function request(platform: PublishRequest["content"]["platform"]): PublishRequest {
  return { media: { filePath: file, fileSizeBytes: 1024, mimeType: "video/mp4", durationSeconds: 40, width: 1080, height: 1920 },
    content: { ...emptySocialContent(platform), title: "A complete clip title", caption: "Watch this moment", postText: "Watch this moment", hashtags: ["#Moment"] },
    settings: {}, idempotencyKey: "operation", checkpoint: vi.fn(async () => undefined) };
}
beforeAll(async () => { folder = await mkdtemp(path.join(tmpdir(), "clipper-publish-")); file = path.join(folder, "export.mp4"); await writeFile(file, Buffer.alloc(1024, 1)); });
afterAll(async () => { await rm(folder, { recursive: true, force: true }); });
beforeEach(() => {
  http.mockReset(); vi.stubGlobal("fetch", http);
  for (const name of ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET", "X_CLIENT_ID", "X_CLIENT_SECRET", "META_APP_ID", "META_APP_SECRET", "TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"]) vi.stubEnv(name, "configured");
  for (const name of ["YOUTUBE", "X", "INSTAGRAM", "FACEBOOK", "TIKTOK"]) vi.stubEnv(`${name}_PUBLISH_CAPABILITY`, "production_ready");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("YouTube resumable delivery", () => {
  it("checkpoints the session and video, sends correct metadata, and leaves unfinished processing pending", async () => {
    const r = request("youtube"); r.settings = { notifySubscribers: false, containsSyntheticMedia: true };
    http.mockResolvedValueOnce(new Response(null, { status: 200, headers: { location: "https://www.googleapis.com/upload/session" } }))
      .mockResolvedValueOnce(new Response(null, { status: 308 }))
      .mockResolvedValueOnce(json({ id: "video1" }))
      .mockResolvedValueOnce(json({ items: [{ status: { uploadStatus: "uploaded" }, processingDetails: { processingStatus: "processing" } }] }));
    const result = await youtubePublisher.publish(ctx, r);
    expect(result).toMatchObject({ success: true, state: "processing", platformPostId: "video1" });
    expect(http.mock.calls[0][0]).toContain("notifySubscribers=false");
    expect(JSON.parse(http.mock.calls[0][1].body).status).toMatchObject({ containsSyntheticMedia: true });
    expect(http.mock.calls[2][1].headers["Content-Range"]).toBe("bytes 0-1023/1024");
    expect(r.checkpoint).toHaveBeenNthCalledWith(1, { platformUploadId: "https://www.googleapis.com/upload/session" });
    expect(r.checkpoint).toHaveBeenNthCalledWith(2, { platformPostId: "video1" });
  });
  it("recovers a completed upload after a lost acknowledgement without uploading bytes again", async () => {
    const r = request("youtube"); r.existingUploadId = "https://www.googleapis.com/upload/session";
    http.mockResolvedValueOnce(json({ id: "video1" })).mockResolvedValueOnce(json({ items: [{ status: { uploadStatus: "processed", privacyStatus: "private" } }] }));
    expect(await youtubePublisher.publish(ctx, r)).toMatchObject({ success: true, state: "published", platformPostId: "video1" });
    expect(http).toHaveBeenCalledTimes(2);
    expect(http.mock.calls[0][1].headers["Content-Range"]).toBe("bytes */1024");
    expect(http.mock.calls[0][1].body).toBeUndefined();
  });
  it("does not call a missing or unreadable video published", async () => {
    http.mockResolvedValueOnce(json({ error: { message: "forbidden" } }, 403));
    expect((await youtubePublisher.getPublishStatus(ctx, "video")).state).toBe("unknown");
  });
});

describe("X API v2", () => {
  function uploadResponses(ready = true) {
    http.mockResolvedValueOnce(json({ data: { id: "444" } })).mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(json({ data: { processing_info: { state: "pending" } } }))
      .mockResolvedValueOnce(json({ data: { id: "444", processing_info: { state: ready ? "succeeded" : "pending" } } }));
  }
  it("uses the v2 initialize/append/finalize contract and records ids before creating the post", async () => {
    uploadResponses(); http.mockResolvedValueOnce(json({ data: { id: "555" } }));
    const r = request("x");
    expect(await xPublisher.publish(ctx, r)).toMatchObject({ success: true, platformMediaId: "444", platformPostId: "555" });
    expect(http.mock.calls.map((c) => String(c[0]))).toEqual([
      "https://api.x.com/2/media/upload/initialize", "https://api.x.com/2/media/upload/444/append", "https://api.x.com/2/media/upload/444/finalize", "https://api.x.com/2/media/upload?media_id=444", "https://api.x.com/2/tweets",
    ]);
    expect(JSON.parse(http.mock.calls[0][1].body).total_bytes).toBe(1024);
    expect(http.mock.calls[1][1].body.get("command")).toBeNull();
    expect(r.checkpoint).toHaveBeenNthCalledWith(1, { platformMediaId: "444" });
    expect(r.checkpoint).toHaveBeenNthCalledWith(2, { committing: true });
    expect(r.checkpoint).toHaveBeenLastCalledWith({ platformPostId: "555", committing: false });
  });
  it("reuses existing media and releases the worker while it processes", async () => {
    http.mockResolvedValueOnce(json({ data: { id: "444", processing_info: { state: "pending" } } }));
    const r = request("x"); r.existingMediaId = "444";
    expect(await xPublisher.publish(ctx, r)).toMatchObject({ success: true, state: "processing", platformMediaId: "444" });
    expect(http).toHaveBeenCalledTimes(1);
  });
  it("leaves an uncertain post request marked in flight after a lost response", async () => {
    http.mockResolvedValueOnce(json({ data: { id: "444", processing_info: { state: "succeeded" } } })).mockRejectedValueOnce(new Error("connection reset"));
    const r = request("x"); r.existingMediaId = "444";
    expect((await xPublisher.publish(ctx, r)).success).toBe(false);
    expect(r.checkpoint).toHaveBeenLastCalledWith({ committing: true });
  });
});

describe("Meta publishing", () => {
  it("validates the professional account returned by a direct Instagram token", async () => {
    vi.stubEnv("INSTAGRAM_CLIENT_ID", "direct"); vi.stubEnv("INSTAGRAM_CLIENT_SECRET", "secret");
    const direct = { ...ctx, accountMetadata: { authType: "instagram_login", igUserId: "1234" } };
    http.mockResolvedValueOnce(json({ data: [{ id: "app-scoped", user_id: "1234", username: "creator" }] }));
    expect(await instagramPublisher.validateConnection(direct)).toMatchObject({ ok: true, username: "@creator" });
    http.mockResolvedValueOnce(json({ user_id: "another-account", username: "other" }));
    expect(await instagramPublisher.validateConnection(direct)).toMatchObject({ ok: false, needsReauth: true });
  });
  it("publishes a directly connected Instagram account through Instagram Graph at every step", async () => {
    const direct = { ...ctx, accountMetadata: { authType: "instagram_login", igUserId: "1234", pageAccessToken: "stale-page-token" } };
    http.mockResolvedValueOnce(json({ id: "container" })).mockResolvedValueOnce(json({ status_code: "FINISHED" }))
      .mockResolvedValueOnce(json({ id: "media" })).mockResolvedValueOnce(json({ permalink: "https://www.instagram.com/reel/direct/" }));
    expect(await instagramPublisher.publish(direct, request("instagram"))).toMatchObject({ success: true, state: "published" });
    expect(http.mock.calls.every(([url]) => new URL(String(url)).hostname === "graph.instagram.com")).toBe(true);
    expect(http.mock.calls[0][1].body.get("access_token")).toBe("test-token");
    http.mockResolvedValueOnce(json({ permalink: "https://www.instagram.com/reel/direct/" }));
    expect((await instagramPublisher.getPublishStatus(direct, "media")).state).toBe("published");
    expect(String(http.mock.calls[4][0])).toContain("graph.instagram.com");
  });
  it("keeps an Instagram container in processing without a fake permalink", async () => {
    http.mockResolvedValueOnce(json({ id: "container1" })).mockResolvedValueOnce(json({ status_code: "IN_PROGRESS" }));
    const r = request("instagram"); r.settings.instagramFormat = "feed";
    expect(await instagramPublisher.publish(ctx, r)).toEqual({ success: true, state: "processing", platformUploadId: "container1" });
    expect(http.mock.calls[0][1].body.get("media_type")).toBe("REELS");
    expect(http.mock.calls[0][1].body.get("video_url")).toContain("/api/social/media-grants/");
    expect(r.checkpoint).toHaveBeenCalledWith({ platformUploadId: "container1" });
  });
  it("resumes the same Instagram container and uses the real returned permalink", async () => {
    http.mockResolvedValueOnce(json({ status_code: "FINISHED" })).mockResolvedValueOnce(json({ id: "media2" })).mockResolvedValueOnce(json({ permalink: "https://www.instagram.com/reel/actualCode/" }));
    const r = request("instagram"); r.existingUploadId = "container1";
    expect(await instagramPublisher.publish(ctx, r)).toMatchObject({ success: true, state: "published", platformPostUrl: "https://www.instagram.com/reel/actualCode/" });
    expect(http.mock.calls.filter((c) => String(c[0]).endsWith("/media"))).toHaveLength(0);
    expect(r.checkpoint).toHaveBeenCalledWith({ platformPostId: "media2", platformMediaId: "media2", committing: false });
  });
  it("does not republish a container already marked PUBLISHED", async () => {
    http.mockResolvedValueOnce(json({ status_code: "PUBLISHED" }));
    const r = request("instagram"); r.existingUploadId = "container1";
    expect(await instagramPublisher.publish(ctx, r)).toMatchObject({ success: false, errorCode: "outcome_unknown" });
    expect(http).toHaveBeenCalledTimes(1);
  });
  it("never sends a Facebook finish request without a video id", async () => {
    http.mockResolvedValueOnce(json({ error: { message: "not allowed" } }, 403));
    const r = request("facebook"); r.settings.facebookFormat = "reel";
    expect((await facebookPublisher.publish(ctx, r)).success).toBe(false);
    expect(http).toHaveBeenCalledTimes(1);
  });
  it("does not interpret a successful HTTP status with success:false as publication", async () => {
    http.mockResolvedValueOnce(json({ video_id: "video3", upload_url: "https://rupload.facebook.com/video-upload/video3" }))
      .mockResolvedValueOnce(json({ success: true })).mockResolvedValueOnce(json({ success: false }));
    const r = request("facebook"); r.settings.facebookFormat = "reel";
    expect((await facebookPublisher.publish(ctx, r)).success).toBe(false);
  });
  it("waits for Facebook publishing to finish", async () => {
    http.mockResolvedValueOnce(json({ status: { video_status: "processing", publishing_phase: { status: "not_started" } } }));
    expect((await facebookPublisher.getPublishStatus(ctx, "video3")).state).toBe("processing");
    http.mockResolvedValueOnce(json({ status: { video_status: "ready", publishing_phase: { status: "complete" } }, permalink_url: "/creator/videos/video3/" }));
    expect(await facebookPublisher.getPublishStatus(ctx, "video3")).toMatchObject({ state: "published", platformPostUrl: "https://www.facebook.com/creator/videos/video3/" });
  });
});

describe("TikTok reviewed posts", () => {
  const creator = { privacy_level_options: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"], max_video_post_duration_sec: 120, comment_disabled: true };
  it("does not transfer content before per-post consent", async () => {
    expect((await tiktokPublisher.publish(ctx, request("tiktok"))).success).toBe(false);
    expect(http).not.toHaveBeenCalled();
  });
  it("uses server-hosted URL transfer and keeps interactions off by default", async () => {
    http.mockResolvedValueOnce(json({ error: { code: "ok" }, data: creator }))
      .mockResolvedValueOnce(json({ error: { code: "ok" }, data: { publish_id: "publish1" } }))
      .mockResolvedValueOnce(json({ error: { code: "ok" }, data: { status: "PROCESSING_UPLOAD" } }));
    const r = request("tiktok"); r.settings = { postConsent: true, musicUsageConfirmed: true, tiktokPrivacyLevel: "PUBLIC_TO_EVERYONE" };
    expect(await tiktokPublisher.publish(ctx, r)).toMatchObject({ success: true, state: "processing", platformUploadId: "publish1" });
    const body = JSON.parse(http.mock.calls[1][1].body);
    expect(body.source_info.source).toBe("PULL_FROM_URL");
    expect(body.source_info.video_url).toContain("/api/social/media-grants/");
    expect(body.post_info).toMatchObject({ disable_comment: true, disable_duet: true, disable_stitch: true });
    expect(r.checkpoint).toHaveBeenCalledWith({ platformUploadId: "publish1", platformPostId: "publish1", committing: false });
  });
  it("does not silently choose a visibility option", async () => {
    http.mockResolvedValueOnce(json({ error: { code: "ok" }, data: creator }));
    const r = request("tiktok"); r.settings = { postConsent: true, musicUsageConfirmed: true };
    expect((await tiktokPublisher.publish(ctx, r)).success).toBe(false);
    expect(http).not.toHaveBeenCalled();
  });
  it("labels inbox delivery as awaiting the user, not published", async () => {
    http.mockResolvedValueOnce(json({ error: { code: "ok" }, data: { status: "SEND_TO_USER_INBOX" } }));
    expect((await tiktokPublisher.getPublishStatus(ctx, "publish1")).state).toBe("awaiting_user");
  });
});
