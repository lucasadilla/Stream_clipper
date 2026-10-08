import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn(), clip: vi.fn() }));
vi.mock("@/lib/aiProvider", () => ({
  hasAnyAiKey: () => true,
  getAiClient: () => ({ chat: { completions: { create: mocks.create } } }),
}));
vi.mock("@/lib/aiModelPolicy", () => ({
  getHookEnginePolicy: () => ({ mode: "shadow", seriousCandidateLimit: 8,
    openingCandidatesPerMoment: 5, enableTemporalReordering: false,
    cheap: { model: "standard-writer", provider: "test", temperature: 0.2, timeoutMs: 30000 },
  }),
}));
vi.mock("@/lib/db", () => ({ prisma: {
  clipSuggestion: { findUnique: mocks.clip },
  eventWindow: { findMany: async () => [] },
} }));
vi.mock("@/services/transcriptService", () => ({
  getTranscriptChunksForRange: async () => [{ text: "Replacing the cable fixed the camera and avoided a new purchase." }],
}));
vi.mock("@/services/speakerContextService", () => ({ readSpeakerContext: async () => null }));

import { buildHookPackages } from "@/services/hookEngineService";
import { generatePlatformCopiesForClip, generatePlatformCopyPackage } from "@/services/platformCopyService";
import type { PlatformKey } from "@/lib/platforms/types";

const context = {
  platform: "youtube_shorts" as const,
  clipTitle: "A cable swap saved this camera",
  clipReason: "Replacing a faulty cable restored the camera and avoided an unnecessary purchase.",
  transcriptText: "Replacing the cable fixed the camera and avoided a new purchase.",
  durationSeconds: 45,
};

describe("automatic AI spend boundaries", () => {
  beforeEach(() => {
    mocks.create.mockReset();
    mocks.clip.mockResolvedValue({
      id: "clip", title: context.clipTitle, reason: context.clipReason,
      streamSessionId: "session", startTimeSeconds: 0, endTimeSeconds: 45,
      rawAiJson: null, streamSession: { title: "Camera repairs", description: "", channelTitle: "Repair Desk" },
    });
  });

  it("builds automatic hook packages locally even with an AI key and shadow mode", async () => {
    const packages = await buildHookPackages([{
      momentId: "moment", contentCategory: "general", title: context.clipTitle,
      startTimeSeconds: 0, endTimeSeconds: 45, focusTimeSeconds: 20,
      momentQuality: 80, mode: "shadow",
      transcriptChunks: [{ id: "speech", startTimeSeconds: 0, endTimeSeconds: 45, text: context.transcriptText }],
    }]);
    expect(packages.size).toBe(1);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("reopening Studio adapts all eight platforms without any AI calls", async () => {
    const platforms: PlatformKey[] = ["youtube_shorts", "youtube_landscape", "tiktok", "instagram_reels",
      "instagram_feed", "facebook_reels", "facebook_feed", "x"];
    for (let open = 0; open < 3; open++) {
      const copies = await generatePlatformCopiesForClip("clip", platforms);
      expect(Object.keys(copies)).toHaveLength(8);
      expect(copies.youtube_shorts?.title).toBe(context.clipTitle);
      expect(copies.youtube_shorts?.description).toContain(context.clipReason);
    }
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("ordinary exports reuse written copy without spending on new alternatives", async () => {
    expect((await generatePlatformCopyPackage(context)).copy.title).toBe(context.clipTitle);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("an explicit regeneration makes one request with one unscored package", async () => {
    mocks.create.mockResolvedValue({ choices: [{ message: { content: JSON.stringify({ candidates: [{
      candidateId: "single", strategy: "explanation", title: "Why this camera needed a new cable",
      description: "A faulty cable caused the disconnections, so replacing it avoided buying another camera.",
      evidence: ["Replacing the cable fixed the camera"],
    }] }) } }] });
    const generated = await generatePlatformCopyPackage(context, { generate: true });
    expect(generated.copy.title).toBe("Why this camera needed a new cable");
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create.mock.calls[0][0]).toMatchObject({ max_tokens: 1200, model: "standard-writer" });
    expect(mocks.create.mock.calls[0][1]).toMatchObject({ maxRetries: 0 });
  });
});
