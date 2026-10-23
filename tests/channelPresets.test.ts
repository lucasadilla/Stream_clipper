import { beforeEach, describe, expect, it, vi } from "vitest";
import { channelPresetSchema, defaultChannelPreset, brandingVideoFilter } from "@/lib/social/channelPreset";
import { buildYouTubeAuthUrl } from "@/services/social/publishers/youtubePublisher";
import { buildTikTokAuthUrl } from "@/services/social/publishers/tiktokPublisher";
const m = vi.hoisted(() => ({ account: vi.fn(), saved: vi.fn(), row: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: {
  connectedSocialAccount: { findFirst: m.account }, socialPublishingPreference: { upsert: m.saved, findFirst: m.row },
} }));
import { getChannelPreset, saveChannelPreset } from "@/services/social/channelPresetService";
beforeEach(() => { vi.clearAllMocks(); m.account.mockResolvedValue({ platform: "youtube" }); });
describe("saved channel presets", () => {
  it("persists account-specific styles under a deterministic ID with validated input", async () => {
    const preset = { ...defaultChannelPreset(), name: "Creator", captionsEnabled: false, branding: { text: "@creator", position: "top-right" as const, color: "#FFFFFF" } };
    await saveChannelPreset("owner", "account", preset); await saveChannelPreset("owner", "account", preset);
    expect(m.saved.mock.calls[0][0].where.id).toBe(m.saved.mock.calls[1][0].where.id);
    expect(m.saved.mock.calls[0][0].create).toMatchObject({ userId: "owner", connectedSocialAccountId: "account", platform: "youtube", platformSettings: { channelPreset: { captionsEnabled: false } } });
    m.row.mockResolvedValue({ platformSettings: { channelPreset: preset } });
    expect(await getChannelPreset("owner", "account")).toEqual(preset);
  });
  it("cannot save styles for another user's account", async () => {
    m.account.mockResolvedValue(null); await expect(saveChannelPreset("other", "account", defaultChannelPreset())).rejects.toThrow(/not found/);
    expect(m.saved).not.toHaveBeenCalled();
  });
  it("rejects invalid layouts and injected FFmpeg color expressions", () => {
    expect(channelPresetSchema.safeParse({ ...defaultChannelPreset(), look: "unknown" }).success).toBe(false);
    expect(channelPresetSchema.safeParse({ ...defaultChannelPreset(), branding: { text: "hello", color: "white,scale=1:1" } }).success).toBe(false);
    const filter = brandingVideoFilter("C:/renders/brand.txt", { text: "a:b'%{danger}", color: "#FFFFFF", position: "bottom-right" }, 1920);
    expect(filter).toContain("textfile="); expect(filter).toContain("expansion=none"); expect(filter).not.toContain("danger");
  });
  it("requests performance permissions only when the user explicitly chooses that connection flow", () => {
    process.env.YOUTUBE_CLIENT_ID = "client"; process.env.TIKTOK_CLIENT_KEY = "client";
    const opts = { state: "state", codeChallenge: "challenge" };
    expect(new URL(buildYouTubeAuthUrl(opts)).searchParams.get("scope")).not.toContain("yt-analytics");
    expect(new URL(buildYouTubeAuthUrl({ ...opts, performanceAccess: true })).searchParams.get("scope")).toContain("yt-analytics.readonly");
    expect(new URL(buildTikTokAuthUrl(opts)).searchParams.get("scope")).not.toContain("video.list");
    expect(new URL(buildTikTokAuthUrl({ ...opts, performanceAccess: true })).searchParams.get("scope")).toContain("video.list");
    delete process.env.YOUTUBE_CLIENT_ID; delete process.env.TIKTOK_CLIENT_KEY;
  });
});
