import { beforeEach, describe, expect, it, vi } from "vitest";
import { showAgentClipResults } from "@/lib/agentWizard";
const m = vi.hoisted(() => ({ source: vi.fn(), probe: vi.fn(), exists: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { clipSuggestion: { findUnique: async () => ({ id: "clip", streamSessionId: "session", startTimeSeconds: 10, endTimeSeconds: 30 }) } } }));
vi.mock("fs", () => ({ existsSync: m.exists }));
vi.mock("fs/promises", () => ({ stat: async () => ({ mtimeMs: 100 }), rename: vi.fn(), unlink: vi.fn() }));
vi.mock("@/lib/storage", () => ({ ensureDir: vi.fn(), getUploadDir: () => "/cache", resolveStoragePath: (value: string) => value, toRelativeStoragePath: (value: string) => value }));
vi.mock("@/lib/ffmpeg", () => ({ probeMedia: m.probe, canDecodeVideoFrame: async () => true }));
vi.mock("@/services/clipSourceService", () => ({ ensureClipSourceForRender: m.source }));
import { ensureClipStudioPlayback } from "@/services/clipStudioPlaybackService";
beforeEach(() => { vi.clearAllMocks(); m.exists.mockReturnValue(true); m.probe.mockResolvedValue({ videoCodec: "h264", durationSeconds: 20 }); });
describe("first usable clip", () => {
  it("keeps existing moments visible during later discovery and transcription", () => {
    expect(showAgentClipResults({ step: "pick", clipCount: 1, finding: true, suggesting: true, transcriptReady: false, suggestRequested: false, waitingForStreamEnd: false })).toBe(true);
    expect(showAgentClipResults({ step: "pick", clipCount: 0, finding: true, suggesting: true, transcriptReady: true, suggestRequested: false, waitingForStreamEnd: false })).toBe(false);
    expect(showAgentClipResults({ step: "pick", clipCount: 1, finding: false, suggesting: false, transcriptReady: true, suggestRequested: true, waitingForStreamEnd: true })).toBe(false);
  });
  it("opens a valid warmed preview even when its remote source cannot be fetched again", async () => {
    m.source.mockRejectedValue(new Error("Remote source unavailable"));
    const result = await ensureClipStudioPlayback("clip");
    expect(result).toMatchObject({ timelineOffsetSeconds: 10, durationSeconds: 20 }); expect(m.source).not.toHaveBeenCalled();
  });
  it("rejects a short cached preview and tries to prepare the full selected range", async () => {
    m.probe.mockResolvedValue({ videoCodec: "h264", durationSeconds: 3 }); m.source.mockRejectedValue(new Error("Source still processing"));
    await expect(ensureClipStudioPlayback("clip")).rejects.toThrow("Source still processing"); expect(m.source).toHaveBeenCalledOnce();
  });
});
