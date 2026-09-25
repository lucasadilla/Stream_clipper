import { beforeEach, describe, expect, it, vi } from "vitest";
const { db, transcribe, extract } = vi.hoisted(() => ({
  db: { clipSuggestion: { findUnique: vi.fn(), update: vi.fn() },
    transcriptChunk: { findMany: vi.fn(), update: vi.fn(), create: vi.fn() },
    chatMessage: { findMany: vi.fn() }, $transaction: vi.fn() },
  transcribe: vi.fn(), extract: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/aiProvider", () => ({ getClipTranscriptionRefinementModel: () => "quality-model",
  getTranscriptionLanguage: () => "en" }));
vi.mock("@/lib/ffmpeg", () => ({ extractAudioSegment: extract }));
vi.mock("@/lib/storage", () => ({ ensureDir: vi.fn(), getUploadDir: () => "unused-caption-test" }));
vi.mock("@/services/accurateClipTranscriptionService", () => ({ transcribeClipAccurately: transcribe }));
vi.mock("@/services/transcriptionSyncService", () => ({ resolveSourceForTranscription: vi.fn() }));
import { refineClipTranscript } from "@/services/clipTranscriptRefinementService";

describe("selected clip transcript updates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("OPENAI_API_KEY", "test-only");
    db.clipSuggestion.findUnique.mockResolvedValue({ id: "clip", streamSessionId: "session",
      startTimeSeconds: 10, endTimeSeconds: 20, rawAiJson: {},
      streamSession: { title: "Live", sourceMedia: [], liveStatus: "ended" } });
    db.chatMessage.findMany.mockResolvedValue([]);
    db.$transaction.mockImplementation((updates) => Promise.all(updates));
    const words = [
      { word: "hello", start: 10, end: 10.5 },
      { word: "recovered", start: 14, end: 14.5 },
      { word: "ending", start: 18, end: 18.5 },
    ];
    transcribe.mockResolvedValue([{ startTimeSeconds: 10, endTimeSeconds: 18.5,
      text: "hello recovered ending", words }]);
  });

  it("writes recovered gap words and preserves speech outside the selected clip", async () => {
    const before = { word: "before", start: 9, end: 9.5 };
    const after = { word: "after", start: 21, end: 21.5 };
    db.transcriptChunk.findMany.mockResolvedValue([
      { id: "a", startTimeSeconds: 9, endTimeSeconds: 11, text: "before old", rawJson: { words: [before] } },
      { id: "b", startTimeSeconds: 18, endTimeSeconds: 22, text: "old after", rawJson: { words: [after] } },
    ]);
    await refineClipTranscript("clip", { inputPath: "master.mp4", timelineOffsetSeconds: 8 });
    const updates = db.transcriptChunk.update.mock.calls.map(([arg]) => arg.data);
    expect(updates.map((u) => u.text)).toEqual(["before hello recovered", "ending after"]);
    expect(updates[0].rawJson.words[0]).toEqual(before);
    expect(updates[1].rawJson.words.at(-1)).toEqual(after);
    expect(transcribe.mock.calls[0][0].options.prompt).toBeUndefined();
    expect(transcribe.mock.calls[0][0].options.qualityPrompt).toContain("livestream");
  });

  it("creates captions when the initial transcription missed the entire range", async () => {
    db.transcriptChunk.findMany.mockResolvedValue([]);
    await refineClipTranscript("clip", { inputPath: "master.mp4", timelineOffsetSeconds: 8,
      startTimeSeconds: 8, endTimeSeconds: 24 });
    expect(db.transcriptChunk.create).toHaveBeenCalledTimes(1);
    expect(db.transcriptChunk.findMany.mock.calls[0][0].where).toMatchObject({
      startTimeSeconds: { lt: 24 }, endTimeSeconds: { gt: 8 },
    });
    expect(db.clipSuggestion.update.mock.calls[0][0].data.rawAiJson.transcriptRefinement)
      .toMatchObject({ start: 8, end: 24, sourceKey: "master.mp4", version: "candidate-transcript-v2" });
  });
});
