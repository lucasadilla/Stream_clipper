import { describe, expect, it } from "vitest";
import { generateAss } from "@/lib/captionAss";
import { DEFAULT_CAPTION_APPEARANCE } from "@/lib/captionAppearance";
import { applyCaptionEdits, remapCueWords } from "@/lib/captionEdits";
import {
  buildCaptionTrack,
  resolveCaptionOverlaps,
  type CaptionCue,
} from "@/lib/captionTrack";
import {
  isValidCaptionText,
  sanitizeCaptionText,
} from "@/lib/captionStyles";

describe("generateAss karaoke", () => {
  it("highlights only the active word like the editor (timed \\c, not progressive \\k)", () => {
    const ass = generateAss({
      width: 1080,
      height: 1920,
      appearance: {
        ...DEFAULT_CAPTION_APPEARANCE,
        karaokeEnabled: true,
        animation: "pop",
        color: "#FFFFFF",
        highlightColor: "#FFE600",
      },
      cues: [
        {
          startTimeSeconds: 1,
          endTimeSeconds: 3,
          text: "hello world",
          words: [
            { word: "hello", start: 1.0, end: 1.5 },
            { word: "world", start: 1.6, end: 2.4 },
          ],
        },
      ],
    });

    const dialogues = ass
      .split("\n")
      .filter((line) => line.startsWith("Dialogue: 0,"));
    expect(dialogues).toHaveLength(1);
    expect(dialogues[0]).not.toContain("{\\k");
    expect(dialogues[0]).toContain("\\t(");
    expect(dialogues[0]).toContain("\\c&H");
    expect(dialogues[0]).toContain("hello");
    expect(dialogues[0]).toContain("world");
    expect(dialogues[0]).toContain("\\fscx86");
    expect(dialogues[0]).toContain("\\t(0,192,");
  });

  it("matches editor fade timing (220ms in, no out)", () => {
    const ass = generateAss({
      width: 1080,
      height: 1920,
      appearance: {
        ...DEFAULT_CAPTION_APPEARANCE,
        karaokeEnabled: false,
        animation: "fade",
      },
      cues: [{ startTimeSeconds: 0, endTimeSeconds: 1, text: "hi" }],
    });
    expect(ass).toContain("\\fad(220,0)");
    expect(ass).not.toContain("\\fad(180,120)");
  });

  it("de-overlaps cues so only one Dialogue is active at a time", () => {
    const resolved = resolveCaptionOverlaps([
      { startTimeSeconds: 0, endTimeSeconds: 2, text: "first" },
      { startTimeSeconds: 1.5, endTimeSeconds: 3, text: "second" },
    ]);
    expect(resolved).toHaveLength(2);
    expect(resolved[0]!.endTimeSeconds).toBeLessThanOrEqual(
      resolved[1]!.startTimeSeconds
    );
    expect(resolved[0]!.text).toBe("first");
    expect(resolved[1]!.text).toBe("second");

    const ass = generateAss({
      width: 1080,
      height: 1920,
      appearance: {
        ...DEFAULT_CAPTION_APPEARANCE,
        karaokeEnabled: false,
        animation: "none",
      },
      cues: [
        { startTimeSeconds: 0, endTimeSeconds: 2, text: "first line" },
        { startTimeSeconds: 1.5, endTimeSeconds: 3, text: "second line" },
      ],
    });
    const dialogues = ass
      .split("\n")
      .filter((line) => line.startsWith("Dialogue: 0,"));
    expect(dialogues).toHaveLength(2);
    // First dialogue must end at or before the second starts (ASS times).
    const end1 = dialogues[0]!.split(",")[2]!;
    const start2 = dialogues[1]!.split(",")[1]!;
    expect(end1 <= start2).toBe(true);
  });

  it("softens hard ASS shadows that look like doubled glyphs", () => {
    const ass = generateAss({
      width: 1080,
      height: 1920,
      appearance: {
        ...DEFAULT_CAPTION_APPEARANCE,
        shadow: 6,
        outlineWidth: 0,
        backgroundOpacity: 0,
        karaokeEnabled: false,
        animation: "none",
      },
      cues: [{ startTimeSeconds: 0, endTimeSeconds: 1, text: "hello" }],
    });
    const style = ass.split("\n").find((line) => line.startsWith("Style: Default,"));
    expect(style).toBeTruthy();
    const fields = style!.split(",");
    // ... BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
    const shadow = Number(fields[fields.length - 6]);
    const outline = Number(fields[fields.length - 7]);
    expect(shadow).toBeLessThanOrEqual(3);
    expect(outline).toBeGreaterThanOrEqual(2);
    expect(ass).toContain("\\blur");
  });

  it("never burns punctuation-only pause placeholders", () => {
    const ass = generateAss({
      width: 1080,
      height: 1920,
      appearance: {
        ...DEFAULT_CAPTION_APPEARANCE,
        smartEmphasisEnabled: false,
      },
      cues: [
        { startTimeSeconds: 0, endTimeSeconds: 1, text: "..." },
        { startTimeSeconds: 1, endTimeSeconds: 2, text: "Real words" },
      ],
    });
    const dialogues = ass
      .split("\n")
      .filter((line) => line.startsWith("Dialogue: 0,"));
    expect(dialogues).toHaveLength(1);
    expect(dialogues[0]).toContain("Real words");
    expect(dialogues[0]).not.toContain("...");
  });
});

describe("remapCueWords", () => {
  it("shifts words by the same delta on a pure cue move", () => {
    const remapped = remapCueWords(
      [
        { word: "a", start: 10, end: 10.4 },
        { word: "b", start: 10.5, end: 11 },
      ],
      10,
      12,
      14,
      16
    );
    expect(remapped).toEqual([
      { word: "a", start: 14, end: 14.4 },
      { word: "b", start: 14.5, end: 15 },
    ]);
  });

  it("keeps karaoke words aligned after applyCaptionEdits move", () => {
    const cues: CaptionCue[] = [
      {
        id: "c1",
        startTimeSeconds: 5,
        endTimeSeconds: 7,
        text: "hello world",
        words: [
          { word: "hello", start: 5.1, end: 5.6 },
          { word: "world", start: 5.7, end: 6.5 },
        ],
      },
    ];
    const edited = applyCaptionEdits(cues, {
      c1: { startTimeSeconds: 8, endTimeSeconds: 10 },
    });
    expect(edited[0]!.words).toEqual([
      { word: "hello", start: 8.1, end: 8.6 },
      { word: "world", start: 8.7, end: 9.5 },
    ]);
  });
});

describe("caption text cleanup", () => {
  it("drops punctuation-only pause placeholders", () => {
    expect(isValidCaptionText("...")).toBe(false);
    expect(isValidCaptionText("…")).toBe(false);
    expect(sanitizeCaptionText("I ... actually won")).toBe("I actually won");
  });

  it("removes ellipsis-only words from timed captions", () => {
    const cues = buildCaptionTrack(
      [
        {
          id: "chunk",
          startTimeSeconds: 0,
          endTimeSeconds: 2,
          text: "I ... actually won",
          rawJson: {
            words: [
              { start: 0, end: 0.2, word: "I" },
              { start: 0.2, end: 0.5, word: "..." },
              { start: 0.5, end: 1, word: "actually" },
              { start: 1, end: 1.4, word: "won" },
            ],
          },
        },
      ],
      "vertical"
    );
    expect(cues).toHaveLength(1);
    expect(cues[0]!.text).toBe("I actually won");
    expect(cues[0]!.words?.map((word) => word.word)).toEqual([
      "I",
      "actually",
      "won",
    ]);
  });

  it("clamps word timings to their transcript chunk", () => {
    const cues = buildCaptionTrack([
      {
        id: "chunk",
        startTimeSeconds: 10,
        endTimeSeconds: 12,
        text: "hello world",
        rawJson: {
          words: [
            { start: 9.5, end: 10.5, word: "hello" },
            { start: 11.5, end: 12.8, word: "world" },
          ],
        },
      },
    ]);
    expect(cues[0]!.startTimeSeconds).toBe(10);
    expect(cues.at(-1)!.endTimeSeconds).toBe(12);
    const words = cues.flatMap((cue) => cue.words ?? []);
    expect(words[0]!.start).toBe(10);
    expect(words.at(-1)!.end).toBe(12);
  });

  it("removes overlaps between adjacent transcript chunks", () => {
    const cues = buildCaptionTrack([
      { id: "a", startTimeSeconds: 0, endTimeSeconds: 2, text: "first" },
      { id: "b", startTimeSeconds: 1.5, endTimeSeconds: 3, text: "second" },
    ]);
    expect(cues[0]!.endTimeSeconds).toBeLessThan(cues[1]!.startTimeSeconds);
  });
});
