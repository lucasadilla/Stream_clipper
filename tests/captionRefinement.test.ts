import { describe, expect, it } from "vitest";
import { reconcileAccurateTextWithTimings } from "@/services/whisperTranscription";
import { buildCaptionTrack, holdCaptionsForReading } from "@/lib/captionTrack";
import { generateAss } from "@/lib/captionAss";
import { DEFAULT_CAPTION_APPEARANCE } from "@/lib/captionAppearance";
import { repairCollapsedWordTimings } from "@/lib/transcriptTiming";

describe("accurate caption coverage", () => {
  it("keeps zero-duration words audible providers otherwise cause to disappear", () => {
    const words = [{ word: "Bro", start: 0, end: 0 },
      { word: "why", start: 0, end: 0.4 }, { word: "laugh", start: 0.4, end: 0.8 },
      { word: "bro?", start: 0.8, end: 0.8 }];
    const repaired = repairCollapsedWordTimings(words);
    expect(repaired.map((w) => w.word)).toEqual(words.map((w) => w.word));
    expect(repaired.every((w) => w.end > w.start)).toBe(true);
    expect(repaired[0]!.start).toBe(0);
    expect(repaired.at(-1)!.end).toBe(0.8);
    const cues = buildCaptionTrack([{ id: "a", startTimeSeconds: 0, endTimeSeconds: 0.8,
      text: "Bro why laugh bro?", rawJson: { words } }], "vertical");
    expect(cues.flatMap((c) => c.words ?? []).map((w) => w.word)).toEqual(words.map((w) => w.word));
  });
  it("retains corrected speech inside gaps in the original segments", () => {
    const corrected = reconcileAccurateTextWithTimings({
      text: "one two three four five six",
      words: ["one", "two", "three", "four", "five", "six"].map((word, i) => ({
        word, start: i < 3 ? i : i + 2, end: i < 3 ? i + 0.5 : i + 2.5,
      })),
      segments: [{ start: 0, end: 2.5, text: "one two three" },
        { start: 5, end: 7.5, text: "four five six" }],
    }, "one two three recovered speech four five six", "quality-model");
    expect(corrected.model).toBe("quality-model");
    expect(corrected.segments!.map((s) => s.text).join(" "))
      .toBe("one two three recovered speech four five six");
    for (const word of corrected.words!) {
      expect(corrected.segments!.some((s) => word.start >= s.start && word.end <= s.end)).toBe(true);
    }
  });

  it("keeps insertions between adjacent anchors instead of moving them across the clip", () => {
    const words = ["one", "two", "three", "four", "five", "six"]
      .map((word, i) => ({ word, start: i, end: i + 1 }));
    const corrected = reconcileAccurateTextWithTimings({ words },
      "one two three four really five six", "quality-model");
    expect(corrected.words!.map((w) => w.word).join(" ")).toBe(corrected.text);
    const inserted = corrected.words!.find((w) => w.word === "really")!;
    expect(inserted.start).toBeGreaterThanOrEqual(3);
    expect(inserted.end).toBeLessThanOrEqual(4);
    expect(inserted.end).toBeGreaterThan(inserted.start);
    expect(corrected.words!.at(-1)).toEqual(words.at(-1));
  });

  it("holds quick phrases, bridges tiny gaps, and leaves real pauses blank", () => {
    const words = [{ word: "hello", start: 0, end: 0.2 }];
    const cues = holdCaptionsForReading([
      { id: "a", startTimeSeconds: 0, endTimeSeconds: 0.2, text: "hello", words },
      { id: "b", startTimeSeconds: 0.45, endTimeSeconds: 1, text: "there" },
      { id: "c", startTimeSeconds: 3, endTimeSeconds: 3.1, text: "yes" },
    ]);
    expect(cues[0]!.endTimeSeconds).toBe(0.45);
    expect(cues[0]!.words).toEqual(words);
    expect(cues[1]!.endTimeSeconds).toBeCloseTo(1.2);
    expect(cues[2]!.endTimeSeconds).toBeCloseTo(3.55);
  });

  it("burns the reading hold into exports while preserving word clocks", () => {
    const cues = buildCaptionTrack([{ id: "a", startTimeSeconds: 0, endTimeSeconds: 1,
      text: "hello world", rawJson: { words: [
        { word: "hello", start: 0, end: 0.4 }, { word: "world", start: 0.4, end: 1 },
      ] } }], "vertical");
    const ass = generateAss({ cues, width: 1080, height: 1920,
      appearance: DEFAULT_CAPTION_APPEARANCE, syncMode: "precise" });
    expect(ass).toContain("0:00:01.20");
    expect(cues.flatMap((c) => c.words ?? []).at(-1)!.end).toBe(1);
  });
});
