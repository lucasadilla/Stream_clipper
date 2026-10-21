import { afterEach, describe, expect, it, vi } from "vitest";
import { assertTikTokPostConsent, safePublishError, safeSocialRedirect, socialGroupStatus } from "@/lib/social/publishingPolicy";
import { canConnectPlatform, forcesPrivateUploads, getPlatformCapability } from "@/lib/social/capabilities";
import { socialCaption } from "@/lib/social/postText";
import { socialDraftKey } from "@/lib/social/draftKey";
import { emptySocialContent } from "@/lib/social/types";
import { createMediaGrant, verifyMediaGrant } from "@/lib/social/oauth";

afterEach(() => vi.unstubAllEnvs());
describe("publishing policy", () => {
  it.each(["https://evil.example/", "//evil.example/", "/\\evil.example", "/path\nLocation: other"])("rejects external callback redirects: %s", (value) => {
    expect(safeSocialRedirect(value)).toBe("/settings/connected-accounts");
  });
  it("preserves a local draft destination", () => expect(safeSocialRedirect("/clips/clip/publish?groupId=draft#preview")).toBe("/clips/clip/publish?groupId=draft#preview"));
  it("does not advertise an unconfigured platform because of a readiness flag", () => {
    vi.stubEnv("X_CLIENT_ID", ""); vi.stubEnv("X_CLIENT_SECRET", ""); vi.stubEnv("X_PUBLISH_CAPABILITY", "production_ready");
    expect(canConnectPlatform("x")).toBe(false); expect(getPlatformCapability("x")).toBe("not_configured");
  });
  it("does not imply that X or Meta has private test uploads", () => {
    for (const key of ["META_APP_ID", "META_APP_SECRET", "X_CLIENT_ID", "X_CLIENT_SECRET"]) vi.stubEnv(key, "configured");
    expect(forcesPrivateUploads("facebook")).toBe(false); expect(forcesPrivateUploads("instagram")).toBe(false); expect(forcesPrivateUploads("x")).toBe(false);
  });
  it("requires consent and an explicit TikTok visibility selection", () => {
    expect(() => assertTikTokPostConsent({})).toThrow(/review/i);
    expect(() => assertTikTokPostConsent({ postConsent: true, musicUsageConfirmed: true })).toThrow(/choose/i);
    expect(() => assertTikTokPostConsent({ postConsent: true, musicUsageConfirmed: true, tiktokPrivacyLevel: "SELF_ONLY" })).not.toThrow();
  });
  it("keeps actionable review and mixed cancellation states honest", () => {
    expect(socialGroupStatus(["cancelled", "cancelled"])).toBe("cancelled");
    expect(socialGroupStatus(["completed", "awaiting_consent"])).toBe("awaiting_review");
    expect(socialGroupStatus(["processing", "awaiting_consent"])).toBe("publishing");
    expect(socialGroupStatus(["completed", "failed"])).toBe("partially_completed");
    expect(socialGroupStatus(["awaiting_user"])).toBe("awaiting_review");
    expect(socialGroupStatus(["outcome_unknown"])).toBe("awaiting_review");
  });
  it("redacts signed upload URLs and credentials in errors", () => {
    const message = safePublishError("Upload failed https://upload.example/?access_token=urlcredential123 Bearer abc123 client_secret=hidden");
    expect(message).not.toContain("urlcredential123"); expect(message).not.toContain("abc123"); expect(message).not.toContain("hidden");
  });
  it("appends edited hashtags without duplicating tags already in the caption", () => {
    expect(socialCaption({ ...emptySocialContent("instagram"), caption: "A moment #Actor", hashtags: ["#Actor", "#Interview", "#Interview"] })).toBe("A moment #Actor\n\n#Interview");
  });
  it("keeps retries stable but gives edited post copy a different identity", async () => {
    const original = { account: "account", exportId: "export", caption: "First caption" };
    const key = await socialDraftKey(original);
    expect(key).toHaveLength(64);
    expect(await socialDraftKey(original)).toBe(key);
    expect(await socialDraftKey({ ...original, caption: "Edited caption" })).not.toBe(key);
  });
  it("rejects expired or tampered media grants", () => {
    const { token } = createMediaGrant({ filePath: "renders/test.mp4" });
    expect(verifyMediaGrant(token)).toEqual({ filePath: "renders/test.mp4" });
    expect(verifyMediaGrant(`${token}.extra`)).toBeNull();
    expect(verifyMediaGrant(`${token}x`)).toBeNull();
    expect(verifyMediaGrant(createMediaGrant({ filePath: "renders/test.mp4", expiresInSeconds: -1 }).token)).toBeNull();
  });
});
