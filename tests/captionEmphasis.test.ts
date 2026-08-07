import { describe, expect, it } from "vitest";
import {
  activeDynamicPunchEvent,
  buildDynamicPunchEvents,
  selectCaptionEmphasisWordIndex,
} from "@/lib/captionEmphasis";
import { generateAss } from "@/lib/captionAss";
import { DEFAULT_CAPTION_APPEARANCE } from "@/lib/captionAppearance";
import { buildDynamicPunchVideoFilter } from "@/lib/ffmpeg";

describe("smart caption emphasis", () => {
  it("selects a meaningful word instead of filler words", () => {
    const words = ["this", "is", "absolutely", "incredible!"];
    expect(selectCaptionEmphasisWordIndex(words)).toBe(3);
  });

  it("burns the selected word with highlight and bold overrides", () => {
    const ass = generateAss({
      width: 1080,
      height: 1920,
      appearance: {
        ...DEFAULT_CAPTION_APPEARANCE,
        karaokeEnabled: false,
        smartEmphasisEnabled: true,
        animation: "none",
      },
      cues: [
        {
          startTimeSeconds: 0,
          endTimeSeconds: 2,
          text: "that was absolutely incredible",
        },
      ],
    });
    expect(ass).toContain("\\b1");
    expect(ass).toContain("\\c&H00FFFF&");
    expect(ass).toContain("incredible");
  });
});

describe("dynamic punch-ins", () => {
  const cues = [
    {
      id: "one",
      startTimeSeconds: 0,
      endTimeSeconds: 2,
      text: "that was unbelievable",
      words: [
        { start: 0, end: 0.3, word: "that" },
        { start: 0.35, end: 0.6, word: "was" },
        { start: 0.7, end: 1.4, word: "unbelievable" },
      ],
    },
    {
      id: "too-close",
      startTimeSeconds: 2,
      endTimeSeconds: 3.5,
      text: "another reaction",
    },
    {
      id: "spaced",
      startTimeSeconds: 5,
      endTimeSeconds: 7,
      text: "completely incredible",
    },
  ];

  it("uses important-word timing and spaces zooms apart", () => {
    const events = buildDynamicPunchEvents(cues);
    expect(events).toHaveLength(2);
    expect(events[0]!.startTimeSeconds).toBe(0.7);
    expect(events[1]!.startTimeSeconds).toBeGreaterThanOrEqual(5);
    expect(activeDynamicPunchEvent(events, 0.8)?.id).toBe(events[0]!.id);
    expect(activeDynamicPunchEvent(events, 3)).toBeNull();
  });

  it("builds a bounded FFmpeg zoompan expression", () => {
    const filter = buildDynamicPunchVideoFilter(
      1080,
      1920,
      buildDynamicPunchEvents(cues)
    );
    expect(filter).toContain("zoompan=z='1+");
    expect(filter).toContain("between(on,21");
    expect(filter).toContain("s=1080x1920:fps=30");
  });
});

