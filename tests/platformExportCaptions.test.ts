import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  renderCreate: vi.fn(), packCreate: vi.fn(), candidates: vi.fn(),
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
  $transaction: vi.fn(async (fn) => fn({ renderJob: { create: mocks.renderCreate }, platformExportPack: { create: mocks.packCreate } })),
  platformExport: { findMany: mocks.candidates },
} }));
vi.mock("@/services/renderSelectionService", () => ({ getLatestCompletedFinalRenderJob: vi.fn(async () => ({
  id: "general", outputPath: "general.mp4", sourceMediaId: "source-1", layout: "center_crop", params: mocks.sourceParams,
})) }));
vi.mock("@/services/renderService", () => ({ parseRenderJobParams: (value: unknown) => value }));
vi.mock("@/lib/storage", () => ({ fileExists: () => true }));

import { createPlatformExportPack, claimNextPlatformExport } from "@/services/platformExportService";

describe("independent platform captions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.renderCreate.mockImplementation(async ({ data }) => ({ id: `render-${data.params.platformTarget.platform}` }));
    mocks.packCreate.mockImplementation(async ({ data }) => data);
    mocks.candidates.mockResolvedValue([]);
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
});
