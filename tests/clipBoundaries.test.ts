import { describe, expect, it } from "vitest";
import {
  hasIncompleteSpeechEnding,
  refineClipToCompleteSpeech,
  refineClipToVisualEvents,
  speechEndingNeedsContinuation,
} from "@/lib/clipBoundaries";

describe("automatic clip speech boundaries", () => {
  it("snaps a mid-sentence cut to the complete transcript segment", () => {
    const result = refineClipToCompleteSpeech({
      start: 5,
      end: 10,
      maximumDurationSeconds: 30,
      transcriptChunks: [
        { startTimeSeconds: 4, endTimeSeconds: 12, text: "Here is the complete answer." },
      ],
    });
    expect(result.start).toBeCloseTo(3.85);
    expect(result.end).toBeCloseTo(12.35);
    expect(result.endingComplete).toBe(true);
  });

  it("extends a dangling clause through the following conclusion", () => {
    const result = refineClipToCompleteSpeech({
      start: 20,
      end: 28,
      maximumDurationSeconds: 30,
      transcriptChunks: [
        { startTimeSeconds: 20, endTimeSeconds: 28, text: "I changed my mind because" },
        { startTimeSeconds: 28.2, endTimeSeconds: 34, text: "the second option solved the problem." },
      ],
    });
    expect(result.end).toBeCloseTo(34.35);
    expect(result.endingComplete).toBe(true);
  });

  it("marks a range incomplete when the conclusion exceeds its cap", () => {
    const result = refineClipToCompleteSpeech({
      start: 0,
      end: 10,
      maximumDurationSeconds: 12,
      transcriptChunks: [
        { startTimeSeconds: 0, endTimeSeconds: 10, text: "The reason is because" },
        { startTimeSeconds: 10.1, endTimeSeconds: 18, text: "the final result changed everything." },
      ],
    });
    // Do not bleed the first word of the unavailable conclusion into the cut.
    expect(result.end).toBeCloseTo(10.08);
    expect(result.endingComplete).toBe(false);
  });

  it("recognizes obvious unfinished transcript endings", () => {
    expect(hasIncompleteSpeechEnding("I only did it because")).toBe(true);
    expect(hasIncompleteSpeechEnding("What I mean is")).toBe(true);
    expect(hasIncompleteSpeechEnding("The thing is")).toBe(true);
    expect(hasIncompleteSpeechEnding("That is why I stopped.")).toBe(false);
  });

  it("joins nearby unpunctuated chunks as one continuous thought", () => {
    const result = refineClipToCompleteSpeech({
      start: 10,
      end: 18,
      maximumDurationSeconds: 30,
      transcriptChunks: [
        { startTimeSeconds: 10, endTimeSeconds: 18, text: "I thought the run was over" },
        { startTimeSeconds: 18.18, endTimeSeconds: 23, text: "then this happened." },
      ],
    });

    expect(result.end).toBeCloseTo(23.35);
    expect(result.endingComplete).toBe(true);
  });

  it("keeps an unanswered question out of suggestions", () => {
    expect(
      speechEndingNeedsContinuation({
        startTimeSeconds: 4,
        endTimeSeconds: 8,
        text: "Do you know what finally fixed it?",
      })
    ).toBe(true);

    const result = refineClipToCompleteSpeech({
      start: 4,
      end: 8,
      maximumDurationSeconds: 20,
      transcriptChunks: [
        { startTimeSeconds: 4, endTimeSeconds: 8, text: "Do you know what finally fixed it?" },
        { startTimeSeconds: 8.25, endTimeSeconds: 13, text: "We replaced the entire cache layer." },
      ],
    });
    expect(result.end).toBeCloseTo(13.35);
    expect(result.endingComplete).toBe(true);
  });

  it("waits for another live transcript pass instead of cutting partial speech", () => {
    const result = refineClipToCompleteSpeech({
      start: 30,
      end: 38,
      maximumDurationSeconds: 30,
      requireSettledEnding: true,
      transcriptChunks: [
        { startTimeSeconds: 30, endTimeSeconds: 38, text: "and the part nobody realizes is" },
      ],
    });

    expect(result.endingComplete).toBe(false);
  });

  it("uses a real pause as a natural ending when punctuation is absent", () => {
    const result = refineClipToCompleteSpeech({
      start: 0,
      end: 7,
      maximumDurationSeconds: 20,
      transcriptChunks: [
        { startTimeSeconds: 0, endTimeSeconds: 7, text: "That was the entire reason I left" },
        { startTimeSeconds: 9, endTimeSeconds: 13, text: "Now for the next topic" },
      ],
    });

    expect(result.end).toBeCloseTo(7.35);
    expect(result.endingComplete).toBe(true);
  });

  it("uses word timings to finish the sentence inside a long transcript chunk", () => {
    const result = refineClipToCompleteSpeech({
      start: 1,
      end: 4.2,
      maximumDurationSeconds: 20,
      transcriptChunks: [
        {
          startTimeSeconds: 0,
          endTimeSeconds: 10,
          text: "I tried the first route. Then everything changed.",
          rawJson: {
            words: [
              { word: "I", start: 0, end: 0.3 },
              { word: "tried", start: 0.35, end: 0.8 },
              { word: "the", start: 0.85, end: 1.1 },
              { word: "first", start: 1.15, end: 1.6 },
              { word: "route.", start: 1.65, end: 2.1 },
              { word: "Then", start: 3, end: 3.3 },
              { word: "everything", start: 3.35, end: 4.2 },
              { word: "changed.", start: 4.25, end: 5 },
            ],
          },
        },
      ],
    });

    expect(result.start).toBeCloseTo(0);
    expect(result.end).toBeCloseTo(5.35);
    expect(result.endingComplete).toBe(true);
  });
});

describe("visual clip boundaries", () => {
  it("preserves visible setup and reaction around the selected range", () => {
    const result = refineClipToVisualEvents({
      start: 20,
      end: 35,
      maximumDurationSeconds: 40,
      events: [
        { timeSeconds: 17, type: "setup", confidence: 0.9 },
        { timeSeconds: 36, type: "outcome", confidence: 0.92 },
        { timeSeconds: 38, type: "reaction", confidence: 0.88 },
      ],
    });
    expect(result.start).toBeCloseTo(16.5);
    expect(result.end).toBeCloseTo(39.1);
    expect(result.adjusted).toBe(true);
  });

  it("ignores low-confidence visual claims", () => {
    const result = refineClipToVisualEvents({
      start: 20,
      end: 35,
      maximumDurationSeconds: 40,
      events: [{ timeSeconds: 40, type: "reaction", confidence: 0.3 }],
    });
    expect(result).toMatchObject({ start: 20, end: 35, adjusted: false });
  });
});
