import { describe, expect, it } from "vitest";
import { generateAss } from "@/lib/captionAss";
import { DEFAULT_CAPTION_APPEARANCE } from "@/lib/captionAppearance";
import { applyCaptionEdits, remapCueWords } from "@/lib/captionEdits";
import { resolveCaptionOverlaps, type CaptionCue } from "@/lib/captionTrack";

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
