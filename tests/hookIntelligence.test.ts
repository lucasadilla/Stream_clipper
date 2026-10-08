import { describe, expect, it } from "vitest";
import {
  buildLocalClipPackage,
  buildLocalTitleCandidates,
  generateHookCandidates,
  reviewHookCandidate,
  shouldApplyHookDecision,
  type BuildHookPackageInput,
} from "@/lib/hookIntelligence";
import {
  normalizedRetentionLabel,
  packagingWarnings,
  rankPlatformPackagingCandidate,
  type PlatformPackagingCandidate,
} from "@/lib/packagingIntelligence";
import type { PlatformCopy } from "@/lib/platforms/types";

function input(): BuildHookPackageInput {
  return {
    momentId: "moment-1",
    creator: "Creator",
    contentCategory: "gaming",
    title: "He Wins the Round With One HP",
    startTimeSeconds: 10,
    endTimeSeconds: 34,
    focusTimeSeconds: 23,
    momentQuality: 86,
    mode: "shadow",
    transcriptChunks: [
      {
        id: "a",
        startTimeSeconds: 10,
        endTimeSeconds: 12,
        text: "Um okay so we are here",
      },
      {
        id: "b",
        startTimeSeconds: 13,
        endTimeSeconds: 16,
        text: "There is absolutely no way this works",
      },
      {
        id: "c",
        startTimeSeconds: 20,
        endTimeSeconds: 23,
        text: "He has one HP and hears the reload",
      },
      {
        id: "d",
        startTimeSeconds: 25,
        endTimeSeconds: 28,
        text: "He pushes and wins the round",
      },
      {
        id: "e",
        startTimeSeconds: 29,
        endTimeSeconds: 31,
        text: "No way he actually did it",
      },
    ],
    narrativePlan: {
      startTimeSeconds: 10,
      endTimeSeconds: 34,
      focusTimeSeconds: 23,
      startChunkId: "a",
      endChunkId: "e",
      focusChunkId: "c",
      arcType: "setup_payoff",
      beats: [
        {
          role: "setup",
          chunkId: "b",
          startTimeSeconds: 13,
          endTimeSeconds: 16,
          evidence: "There is absolutely no way this works",
          strength: 75,
        },
        {
          role: "payoff",
          chunkId: "d",
          startTimeSeconds: 25,
          endTimeSeconds: 28,
          evidence: "He pushes and wins the round",
          strength: 94,
        },
        {
          role: "reaction",
          chunkId: "e",
          startTimeSeconds: 29,
          endTimeSeconds: 31,
          evidence: "No way he actually did it",
          strength: 88,
        },
      ],
      scores: {
        hook: 78,
        payoff: 94,
        completeness: 91,
        standalone: 82,
        coherence: 90,
        pacing: 83,
        total: 88,
      },
      contextChunks: [],
      selectedText: "There is absolutely no way this works. He pushes and wins the round.",
      endingComplete: true,
      accepted: true,
    },
    visualContext: {
      version: "visual-context-v2",
      sourceId: "source-1",
      startTimeSeconds: 10,
      endTimeSeconds: 34,
      eventType: "candidate",
      summary: "The enemy appears, the round ends, and the creator reacts.",
      events: [
        {
          timeSeconds: 20.2,
          type: "action",
          description: "An enemy appears while one HP remains.",
          confidence: 0.92,
        },
        {
          timeSeconds: 25.4,
          type: "outcome",
          description: "The round victory indicator appears.",
          confidence: 0.96,
        },
        {
          timeSeconds: 29.1,
          type: "reaction",
          description: "The creator visibly reacts to the win.",
          confidence: 0.91,
        },
      ],
      confidence: 0.91,
      uncertainties: [],
      sufficient: true,
      analysisLevel: "video",
      modelVersion: "visual-test",
      evidence: [],
    },
  };
}

describe("hook intelligence", () => {
  it("generates and compares several grounded opening structures", () => {
    const candidates = generateHookCandidates(input());
    const types = new Set(candidates.map((candidate) => candidate.hookType));
    expect(types).toContain("natural");
    expect(types).toContain("context_compressed");
    expect(types).toContain("quote_first");
    expect(types).toContain("action_first");
    expect(types).toContain("reaction_first");
    expect(types).toContain("payoff_tease");

    const quote = candidates.find((candidate) => candidate.hookType === "quote_first");
    expect(quote?.firstCaptionText).toContain("There is absolutely no way");
    const tease = candidates.find((candidate) => candidate.hookType === "payoff_tease");
    expect(tease?.requiresTemporalReordering).toBe(true);
    expect(tease?.sourceSegments).toHaveLength(2);
  });

  it("records first-second metrics, alternatives, review, and HookDNA", () => {
    const clipPackage = buildLocalClipPackage(input());
    expect(clipPackage.selectedMoment.momentQuality).toBe(86);
    expect(clipPackage.selectedMoment.hookability).toBeGreaterThan(0);
    expect(clipPackage.hookCandidates.length).toBeGreaterThanOrEqual(5);
    expect(clipPackage.selectedHook.openingMetrics.firstFrameStrength).toBeGreaterThanOrEqual(0);
    expect(clipPackage.coverCandidates[0]?.timestampSeconds).toBe(25.4);
    expect(clipPackage.hookDNA.sourceMomentId).toBe("moment-1");
    expect(clipPackage.hookDNA.firstCaptionText).toBe(
      clipPackage.selectedHook.firstCaptionText
    );
    expect(clipPackage.qualityReview.repairPasses).toBeLessThanOrEqual(1);
  });

  it("does not promote a broken first-caption fragment into a title", () => {
    const hook = {
      ...generateHookCandidates(input())[0]!,
      firstCaptionText:
        "Of Because It's You Know Hugely Profitable You Feel Like",
    };
    const titles = buildLocalTitleCandidates(
      "He Wins the Round With One HP",
      hook
    );
    expect(titles.map((candidate) => candidate.title)).not.toContain(
      hook.firstCaptionText
    );
    expect(titles[0]?.title).toBe("He Wins the Round With One HP");
  });

  it("rejects confusion and missing context in the bounded critic", () => {
    const candidate = generateHookCandidates(input())[0]!;
    const issues = reviewHookCandidate({
      ...candidate,
      clarity: 20,
      contextBurden: 90,
    });
    expect(issues.map((issue) => issue.code)).toContain("opening_confusion");
    expect(issues.map((issue) => issue.code)).toContain("missing_context");
  });

  it("keeps shadow decisions inert and makes A/B assignment stable", () => {
    expect(shouldApplyHookDecision("shadow", "moment-1", 100)).toBe(false);
    expect(shouldApplyHookDecision("new", "moment-1", 0)).toBe(true);
    expect(shouldApplyHookDecision("ab", "moment-1", 37)).toBe(
      shouldApplyHookDecision("ab", "moment-1", 37)
    );
    expect(shouldApplyHookDecision("ab", "moment-1", 0)).toBe(false);
    expect(shouldApplyHookDecision("ab", "moment-1", 100)).toBe(true);
  });
});

describe("packaging intelligence", () => {
  const copy: PlatformCopy = {
    title: "He Wins the Round With One HP",
    caption: null,
    postText: null,
    description: "With one HP left, he hears the reload and pushes.",
    hashtags: ["#Valorant", "#OneHP"],
    tags: ["Valorant", "one HP clutch"],
    quoteText: "There is absolutely no way this works",
    thumbnailText: null,
    pinnedComment: "Would you have pushed here?",
  };
  const candidate: PlatformPackagingCandidate = {
    candidateId: "specific",
    strategy: "specific_fact",
    ...copy,
    evidence: ["one HP and hears the reload"],
    specificity: 94,
    curiosity: 82,
    accuracy: 98,
    brevity: 90,
    naturalness: 92,
    keywordRelevance: 88,
    platformSuitability: 94,
    spoilerRisk: 18,
    clickbaitRisk: 2,
  };

  it("rewards grounded platform packages and penalizes unrelated tags", () => {
    const context = "He has one HP and hears the reload before he pushes.";
    expect(rankPlatformPackagingCandidate(candidate, copy, context).rankScore).toBeGreaterThan(75);
    const warnings = packagingWarnings(
      { ...candidate, hashtags: ["#CelebrityNews", "#DanceTrend"] },
      { ...copy, hashtags: ["#CelebrityNews", "#DanceTrend"] },
      context
    );
    expect(warnings).toContain("Most hashtags are not supported by the clip context.");
  });

  it("normalizes retention against available baselines without inventing data", () => {
    expect(
      normalizedRetentionLabel({
        observed: 0.72,
        creatorBaseline: 0.6,
        platformBaseline: 0.55,
        categoryBaseline: null,
      })
    ).toBeCloseTo(0.2522, 4);
    expect(
      normalizedRetentionLabel({
        observed: null,
        creatorBaseline: 0.6,
        platformBaseline: 0.55,
        categoryBaseline: 0.5,
      })
    ).toBeNull();
  });
});

