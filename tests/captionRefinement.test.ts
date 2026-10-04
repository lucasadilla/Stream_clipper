import { describe, expect, it } from "vitest";
import { reconcileAccurateTextWithTimings } from "@/services/whisperTranscription";
import { buildCaptionTrack, holdCaptionsForReading } from "@/lib/captionTrack";
import { generateAss } from "@/lib/captionAss";
import { DEFAULT_CAPTION_APPEARANCE } from "@/lib/captionAppearance";
import { repairCollapsedWordTimings } from "@/lib/transcriptTiming";
import {
  collapseRepeatedTranscriptBlocks,
  collapseRepeatedTranscriptText,
  collapseRepeatedTranscriptWords,
} from "@/lib/transcriptRepetition";

describe("accurate caption coverage", () => {
  it("collapses a title-like phrase loop while preserving one spoken copy", () => {
    const phrase = ["Bro", "why", "are", "you", "saying", "LOL?"];
    const loopedWords = Array.from({ length: 4 }, (_, repeat) =>
      phrase.map((word, index) => ({
        word,
        start: repeat * 2 + index * 0.2,
        end: repeat * 2 + index * 0.2 + 0.18,
      }))
    ).flat();

    expect(collapseRepeatedTranscriptWords(loopedWords).map((word) => word.word))
      .toEqual(phrase);
    expect(collapseRepeatedTranscriptText(
      "Bro why are you saying LOL? Bro why are you saying LOL? Bro why are you saying LOL?"
    )).toBe("Bro why are you saying LOL?");
    expect(collapseRepeatedTranscriptBlocks(
      [0, 8, 16].map((start) => ({ start, text: phrase.join(" ") })),
      (segment) => segment.text
    )).toEqual([{ start: 0, text: phrase.join(" ") }]);
  });

  it("does not collapse ordinary repeated emphasis", () => {
    expect(collapseRepeatedTranscriptText("no no no, this is actually happening"))
      .toBe("no no no, this is actually happening");
    expect(collapseRepeatedTranscriptText("happy birthday happy birthday happy birthday"))
      .toBe("happy birthday happy birthday happy birthday");
  });

  it("removes a persisted title loop from the rendered caption track", () => {
    const title = "Bro why are you saying LOL?";
    const cues = buildCaptionTrack([
      { id: "a", startTimeSeconds: 0, endTimeSeconds: 1.5, text: title },
      { id: "b", startTimeSeconds: 8, endTimeSeconds: 9.5, text: title },
      { id: "c", startTimeSeconds: 16, endTimeSeconds: 17.5, text: title },
      { id: "d", startTimeSeconds: 24, endTimeSeconds: 25.5, text: title },
    ], "vertical");

    expect(cues).toHaveLength(1);
    expect(cues[0]!.text.replace(/\n/g, " ")).toBe(title);
  });

  it("rejects a quality pass that replaces speech with a repeated phrase", () => {
    const original = "we finally found the hidden room behind the waterfall";
    const words = original.split(" ").map((word, index) => ({
      word,
      start: index * 0.25,
      end: index * 0.25 + 0.2,
    }));
    const loop = "hidden room behind the waterfall ".repeat(3).trim();
    const corrected = reconcileAccurateTextWithTimings(
      { text: original, words },
      loop,
      "quality-model"
    );
    expect(corrected.text).toBe(original);
    expect(corrected.model).toBeUndefined();
  });

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
