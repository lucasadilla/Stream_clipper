import { describe, expect, it } from "vitest";
import {
  LIVE_NOW_CONTEXT_OVERLAP_SECONDS,
  LIVE_NOW_ROLL_SECONDS,
  liveSuggestionWindow,
} from "@/lib/agentWizard";

describe("live Agent suggestion windows", () => {
  it("checks for new clips after one minute of transcript", () => {
    expect(LIVE_NOW_ROLL_SECONDS).toBe(60);
  });

  it("keeps a short overlap so boundary-crossing moments retain context", () => {
    expect(LIVE_NOW_CONTEXT_OVERLAP_SECONDS).toBe(30);
    expect(liveSuggestionWindow(180, 245)).toEqual({
      fromSeconds: 150,
      throughSeconds: 245,
    });
  });

  it("never produces a negative first-wave start", () => {
    expect(liveSuggestionWindow(10, 70)).toEqual({
      fromSeconds: 0,
      throughSeconds: 70,
    });
  });
});
