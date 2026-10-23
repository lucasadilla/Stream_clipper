import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  renderCreate: vi.fn(), packCreate: vi.fn(), candidates: vi.fn(), master: vi.fn(), reusable: vi.fn(),
  clip: { id: "clip-1", streamSessionId: "session-1", title: "Test", startTimeSeconds: 10, endTimeSeconds: 25 },
  sourceParams: {
    streamSessionId: "session-1", clipSuggestionId: "clip-1", sourceMediaId: "source-1",
    startTimeSeconds: 10, endTimeSeconds: 25, format: "vertical", includeCaptions: true,
    captionCues: [{ id: "edited", startTimeSeconds: 11, endTimeSeconds: 12, text: "Edited caption" }],
    verticalLayout: { layout: "center_crop", captions: { enabled: true, position: "lower" } },
  },
}));
vi.mock("@/lib/db", () => ({ prisma: {
  clipSuggestion: { findUnique: vi.fn(async () => mocks.clip) },
  $transaction: vi.fn(async (fn) => fn({ $executeRaw: vi.fn(), renderJob: { create: mocks.renderCreate }, platformExportPack: { create: mocks.packCreate, findFirst: mocks.reusable } })),
  platformExport: { findMany: mocks.candidates },
  renderJob: { findFirst: mocks.master },
} }));
vi.mock("@/services/renderSelectionService", () => ({ getLatestCompletedFinalRenderJob: vi.fn(async () => ({
  id: "general", outputPath: "general.mp4", sourceMediaId: "source-1", layout: "center_crop", params: mocks.sourceParams,
})) }));
vi.mock("@/services/renderService", () => ({ parseRenderJobParams: (value: unknown) => value }));
vi.mock("@/lib/storage", () => ({ fileExists: () => true }));

import { createPlatformExportPack, claimNextPlatformExport } from "@/services/platformExportService";
import { defaultChannelPreset } from "@/lib/social/channelPreset";

describe("independent platform captions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.renderCreate.mockImplementation(async ({ data }) => ({ id: `render-${data.params.platformTarget.platform}` }));
    mocks.packCreate.mockImplementation(async ({ data }) => data);
    mocks.candidates.mockResolvedValue([]);
    mocks.reusable.mockResolvedValue(null);
    mocks.master.mockResolvedValue({ id: "chosen-master", outputPath: "chosen.mp4", params: mocks.sourceParams });
  });

  it("pins the exact Studio master and rejects a different clip's or unfinished render", async () => {
    const request = { platforms: ["tiktok" as const], includeCaptions: true, burnSubtitles: true, generateCopy: false, xQuoteCard: false, sourceRenderJobId: "chosen-master" };
    await createPlatformExportPack("clip-1", request);
    expect(mocks.master).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "chosen-master", clipSuggestionId: "clip-1", streamSessionId: "session-1", status: "completed" }) }));
    expect(mocks.packCreate.mock.calls[0][0].data.exports.create[0].exportSettings.sourceRenderJobId).toBe("chosen-master");
    mocks.master.mockResolvedValueOnce(null);
    await expect(createPlatformExportPack("clip-1", request)).rejects.toThrow(/Render the clip/);
    mocks.master.mockResolvedValueOnce({ id: "preview", outputPath: "preview.mp4", params: { ...mocks.sourceParams, preview: true } });
    await expect(createPlatformExportPack("clip-1", request)).rejects.toThrow(/completed general/);
    expect(mocks.renderCreate).toHaveBeenCalledTimes(1);
  });
  it("reuses a matching pack after a lost response without creating another encode", async () => {
    const existing = { id: "pack", exports: [{ status: "completed", outputPath: "finished.mp4" }] };
    mocks.reusable.mockResolvedValue(existing);
    const result = await createPlatformExportPack("clip-1", { platforms: ["tiktok"], includeCaptions: true, burnSubtitles: true, generateCopy: false, xQuoteCard: false });
    expect(result).toBe(existing); expect(mocks.renderCreate).not.toHaveBeenCalled(); expect(mocks.packCreate).not.toHaveBeenCalled();
    expect(mocks.reusable.mock.calls[0][0].where.exports.some.exportSettings).toMatchObject({ path: ["requestHash"], equals: expect.stringMatching(/^[a-f0-9]{64}$/) });
  });
  it("preserves completed destinations when retrying a partially failed pack", async () => {
    mocks.reusable.mockResolvedValue({ id: "partial", exports: [{ platform: "tiktok", status: "completed", outputPath: "ready.mp4", renderJobId: "finished-render", presetName: "TikTok", exportSettings: {}, validationWarnings: [], hashtags: [] }, { platform: "youtube_landscape", status: "failed" }] });
    await createPlatformExportPack("clip-1", { platforms: ["tiktok", "youtube_landscape"], includeCaptions: true, burnSubtitles: true, generateCopy: false, xQuoteCard: false });
    expect(mocks.renderCreate).toHaveBeenCalledOnce();
    const exports = mocks.packCreate.mock.calls[0][0].data.exports.create;
    expect(exports[0]).toMatchObject({ status: "completed", outputPath: "ready.mp4", renderJobId: "finished-render" });
    expect(exports[1].renderJobId).toBe("render-youtube_landscape");
  });
  it("creates separate source renders for caption-on and caption-off destinations", async () => {
    await createPlatformExportPack("clip-1", {
      platforms: ["tiktok", "youtube_landscape"],
      includeCaptions: true, burnSubtitles: true, generateCopy: false, xQuoteCard: false,
      captionOptions: { tiktok: false, youtube_landscape: true },
    });
    const renders = mocks.renderCreate.mock.calls.map(([arg]) => arg.data);
    expect(renders[0].includeCaptions).toBe(false);
    expect(renders[0].params.verticalLayout.captions.enabled).toBe(false);
    expect(renders[1].includeCaptions).toBe(true);
    expect(renders[1].params.captionCues[0].text).toBe("Edited caption");
    expect(renders[1].params.platformTarget).toEqual({ platform: "youtube_landscape", outputId: "landscape" });
    expect(renders.every((render) => render.sourceMediaId === "source-1")).toBe(true);
    const exports = mocks.packCreate.mock.calls[0][0].data.exports.create;
    expect(exports[0].renderJobId).toBe("render-tiktok");
    expect(exports[0].exportSettings.burnSubtitles).toBe(false);
    expect(exports[1].renderJobId).toBe("render-youtube_landscape");
    expect(exports[1].exportSettings.burnSubtitles).toBe(true);
  });

  it("waits for dependencies but allows failed renders to propagate an export error", async () => {
    await claimNextPlatformExport();
    expect(mocks.candidates.mock.calls[0][0].where.OR).toContainEqual({
      renderJob: { status: { in: ["completed", "failed"] } },
    });
  });
  it("pins a channel's styling and branding to its own original-source export", async () => {
    const preset = { ...defaultChannelPreset("Gaming account"), look: "gaming" as const, captionsEnabled: false,
      branding: { text: "@creator", position: "top-left" as const, color: "#FFFFFF" } };
    await createPlatformExportPack("clip-1", { platforms: ["tiktok"], includeCaptions: true, burnSubtitles: true, generateCopy: false, xQuoteCard: false,
      channelPreset: { accountId: "creator-account", preset } });
    const render = mocks.renderCreate.mock.calls[0][0].data;
    expect(render.params).toMatchObject({ includeCaptions: false, branding: { text: "@creator" }, verticalLayout: { layout: "facecam_top_gameplay_bottom", captions: { enabled: false } } });
    expect(render.sourceMediaId).toBe("source-1");
    expect(mocks.packCreate.mock.calls[0][0].data.exports.create[0].exportSettings).toMatchObject({ channelPresetAccountId: "creator-account", channelPresetHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(mocks.sourceParams.verticalLayout.layout).toBe("center_crop");
  });
});
