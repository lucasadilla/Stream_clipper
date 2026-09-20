import { describe, expect, it } from "vitest";
import {
  LIVE_NOW_CONTEXT_OVERLAP_SECONDS,
  LIVE_NOW_ROLL_SECONDS,
  liveSuggestionWindow,
  mergeSuggestionWizardState,
  resolveAgentDisplayStep,
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

describe("Agent display state", () => {
  it("shows existing clips when a stale refresh reports transcribing", () => {
    expect(
      resolveAgentDisplayStep({
        step: "transcribing",
        hasVisibleClips: true,
        hasActiveClip: false,
      })
    ).toBe("pick");
  });

  it("returns to picks when an editor step references a missing clip", () => {
    expect(
      resolveAgentDisplayStep({
        step: "edit",
        hasVisibleClips: true,
        hasActiveClip: false,
      })
    ).toBe("pick");
  });

  it("keeps a valid editor step intact", () => {
    expect(
      resolveAgentDisplayStep({
        step: "export",
        hasVisibleClips: true,
        hasActiveClip: true,
      })
    ).toBe("export");
  });
});

describe("suggestion wizard updates", () => {
  it("preserves edits made while suggestions were being generated", () => {
    const current = {
      step: "edit" as const,
      selectedClipIds: ["clip-1"],
      queueIndex: 0,
      lookPreset: "auto" as const,
      faceAnalysisJobId: "face-1",
      includeCaptions: false,
      suggestRequested: true,
      cadence: "live_now" as const,
      lastSuggestThroughSeconds: 120,
    };

    expect(
      mergeSuggestionWizardState(current, {
        hasClips: true,
        isLiveAgent: true,
        throughSeconds: 180,
      })
    ).toEqual({
      ...current,
      lastSuggestThroughSeconds: 180,
    });
  });

  it("advances a non-interactive state to picks when clips arrive", () => {
    expect(
      mergeSuggestionWizardState(
        {
          step: "transcribing",
          selectedClipIds: [],
          queueIndex: 0,
          lookPreset: null,
          faceAnalysisJobId: null,
          includeCaptions: true,
          suggestRequested: false,
          cadence: null,
          lastSuggestThroughSeconds: 0,
        },
        { hasClips: true, isLiveAgent: false, throughSeconds: 60 }
      )
    ).toMatchObject({
      step: "pick",
      suggestRequested: true,
      lastSuggestThroughSeconds: 60,
    });
  });
});
