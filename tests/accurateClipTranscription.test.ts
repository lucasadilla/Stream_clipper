import { describe, expect, it, vi } from "vitest";
import os from "os";
import fs from "fs/promises";
import path from "path";
const { extract, transcribe } = vi.hoisted(() => ({ extract: vi.fn(), transcribe: vi.fn() }));
vi.mock("@/lib/ffmpeg", () => ({ extractAudioSegment: extract }));
vi.mock("@/services/whisperTranscription", () => ({ transcribeWhisperAudio: transcribe }));
import { transcribeClipAccurately } from "@/services/accurateClipTranscriptionService";

describe("short-window caption verification", () => {
  it("keeps every boundary word once and merges a tiny final tail", async () => {
    extract.mockResolvedValue(undefined);
    const allWords = [0.2, 17.7, 18.1, 35.8, 36.2, 54.5].map((time, i) => ({
      word: `word${i}`, start: 100 + time, end: 100 + time + 0.1,
    }));
    transcribe.mockImplementation(async (_file: string, offset: number) => {
      const words = allWords.filter((w) => w.start >= offset && w.end <= offset + 22);
      return [{ startTimeSeconds: words[0]!.start, endTimeSeconds: words.at(-1)!.end,
        text: words.map((w) => w.word).join(" "), words }];
    });
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "caption-window-"));
    try {
      const result = await transcribeClipAccurately({ sourcePath: "source.mp4", sourceStart: 3,
        timelineStart: 100, duration: 55, tempDir, options: { language: "en" } });
      expect(result.flatMap((s) => s.words ?? [])).toEqual(allWords);
      expect(extract).toHaveBeenCalledTimes(3);
      expect(extract.mock.calls[0]!.slice(2)).toEqual([3, 19.5, { accurateSeek: true }]);
      expect(extract.mock.calls[2]!.slice(2)).toEqual([37.5, 20.5, { accurateSeek: true }]);
    } finally {
      await fs.rmdir(tempDir);
    }
  });
});
