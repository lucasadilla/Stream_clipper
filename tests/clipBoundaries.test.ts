import { describe, expect, it } from "vitest";
import {
  hasIncompleteSpeechEnding,
  refineClipToCompleteSpeech,
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
    expect(result.end).toBe(10.35);
    expect(result.endingComplete).toBe(false);
  });

  it("recognizes obvious unfinished transcript endings", () => {
    expect(hasIncompleteSpeechEnding("I only did it because")).toBe(true);
    expect(hasIncompleteSpeechEnding("That is why I stopped.")).toBe(false);
  });
});
