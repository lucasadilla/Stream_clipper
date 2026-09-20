import { describe, expect, it } from "vitest";
import { DEFAULT_CAPTION_APPEARANCE } from "@/lib/captionAppearance";
import { generateAss } from "@/lib/captionAss";
import {
  CAPTION_DIRECTOR_VERSION,
  buildAutomaticCaptionDirection,
  captionCueFingerprint,
  directCaptionTrack,
  effectiveCaptionAnimation,
  parseCaptionDirectionPlan,
  type CaptionDirectionPlan,
} from "@/lib/captionDirector";
import { buildCaptionTrack, type CaptionCue } from "@/lib/captionTrack";

function spokenWords(text: string): string[] {
  return text.replace(/\n/g, " ").split(/\s+/).filter(Boolean);
}

describe("professional caption direction", () => {
  it("never overrides the animation explicitly selected by the user", () => {
    const cue: CaptionCue = {
      id: "setup",
      startTimeSeconds: 0,
      endTimeSeconds: 2,
      text: "Here is the setup",
      direction: {
        role: "setup",
        intensity: "subtle",
        emphasisWordIndexes: [],
        animation: "fade",
      },
    };

    expect(effectiveCaptionAnimation(cue, "wordReveal")).toBe("wordReveal");
    expect(effectiveCaptionAnimation(cue, "rise")).toBe("rise");
  });

  it("splits long untimed speech without dropping any transcript words", () => {
    const text =
      "The first attempt looked impossible, but then the final move changed the entire match and everyone understood why.";
    const cues = buildCaptionTrack(
      [
        {
          id: "segment",
          startTimeSeconds: 10,
          endTimeSeconds: 18,
          text,
        },
      ],
      "vertical"
    );

    expect(cues.length).toBeGreaterThan(1);
    expect(cues.flatMap((cue) => spokenWords(cue.text))).toEqual(
      spokenWords(text)
    );
    expect(cues.every((cue) => cue.text.split("\n").length <= 2)).toBe(true);
  });

  it("uses speech pauses and avoids a stranded final word", () => {
    const cues = buildCaptionTrack(
      [
        {
          id: "timed",
          startTimeSeconds: 0,
          endTimeSeconds: 4,
          text: "I thought it was over but somehow we won",
          rawJson: {
            words: [
              { start: 0, end: 0.2, word: "I" },
              { start: 0.2, end: 0.55, word: "thought" },
              { start: 0.56, end: 0.75, word: "it" },
              { start: 0.76, end: 1.05, word: "was" },
              { start: 1.06, end: 1.4, word: "over" },
              { start: 2.05, end: 2.25, word: "but" },
              { start: 2.26, end: 2.8, word: "somehow" },
              { start: 2.81, end: 3.05, word: "we" },
              { start: 3.06, end: 3.4, word: "won" },
            ],
          },
        },
      ],
      "vertical"
    );

    expect(cues).toHaveLength(2);
    expect(cues[0]!.text).toContain("over");
    expect(spokenWords(cues[1]!.text).length).toBeGreaterThan(1);
  });

  it("repairs a one-word overflow tail split across transcript chunks", () => {
    const cues = buildCaptionTrack(
      [
        {
          id: "a",
          startTimeSeconds: 0,
          endTimeSeconds: 1.1,
          text: "Oh, loading, loading,",
        },
        {
          id: "b",
          startTimeSeconds: 1.1,
          endTimeSeconds: 1.55,
          text: "loading.",
        },
      ],
      "vertical"
    );

    expect(cues).toHaveLength(1);
    expect(cues[0]!.text.replace("\n", " ")).toBe(
      "Oh, loading, loading, loading."
    );
  });

  it("assigns a complete restrained story rhythm", () => {
    const cues: CaptionCue[] = [
      { id: "a", startTimeSeconds: 0, endTimeSeconds: 1, text: "This looked impossible" },
      { id: "b", startTimeSeconds: 1, endTimeSeconds: 2, text: "But one move changed it" },
      { id: "c", startTimeSeconds: 2, endTimeSeconds: 3, text: "We actually won" },
    ];
    const plan = buildAutomaticCaptionDirection(cues);

    expect(plan.cues.a?.role).toBe("hook");
    expect(plan.cues.b?.role).toBe("turn");
    expect(plan.cues.c?.role).toBe("payoff");
    expect(
      Object.values(plan.cues).every(
        (direction) => direction.emphasisWordIndexes.length === 0
      )
    ).toBe(true);
  });

  it("rejects an AI plan after caption text changes", () => {
    const cues: CaptionCue[] = [
      { id: "a", startTimeSeconds: 0, endTimeSeconds: 1, text: "Original payoff" },
    ];
    const plan: CaptionDirectionPlan = {
      ...buildAutomaticCaptionDirection(cues),
      generatedBy: "ai",
    };
    const edited = [{ ...cues[0]!, text: "Different ending" }];

    expect(captionCueFingerprint(edited)).not.toBe(plan.fingerprint);
    expect(parseCaptionDirectionPlan(plan, edited)).toBeNull();
    expect(directCaptionTrack(edited, plan)[0]!.direction?.role).toBe("hook");
  });

  it("removes legacy AI-directed word emphasis", () => {
    const cues: CaptionCue[] = [
      {
        id: "setup",
        startTimeSeconds: 0,
        endTimeSeconds: 2,
        text: "The difficult second attempt",
      },
    ];
    const plan: CaptionDirectionPlan = {
      version: CAPTION_DIRECTOR_VERSION,
      fingerprint: captionCueFingerprint(cues),
      generatedBy: "ai",
      createdAt: new Date(0).toISOString(),
      cues: {
        setup: {
          role: "setup",
          intensity: "standard",
          emphasisWordIndexes: [1, 2],
          animation: "fade",
        },
      },
    };

    expect(
      directCaptionTrack(cues, plan)[0]!.direction?.emphasisWordIndexes
    ).toEqual([]);
  });

  it("burns uniform caption words without directed bold emphasis", () => {
    const cue: CaptionCue = {
      id: "payoff",
      startTimeSeconds: 0,
      endTimeSeconds: 2,
      text: "we finally won",
      words: [
        { start: 0, end: 0.4, word: "we" },
        { start: 0.45, end: 1.1, word: "finally" },
        { start: 1.15, end: 1.8, word: "won" },
      ],
      direction: {
        role: "payoff",
        intensity: "strong",
        emphasisWordIndexes: [2],
        animation: "wordReveal",
      },
    };
    const ass = generateAss({
      cues: [cue],
      appearance: DEFAULT_CAPTION_APPEARANCE,
      width: 1080,
      height: 1920,
      format: "vertical",
    });

    expect(ass).not.toContain("\\b1");
    expect(ass).toContain("won");
    expect(ass).not.toContain("\\fscx");
    expect(ass).not.toContain("\\fscy");
  });
});
