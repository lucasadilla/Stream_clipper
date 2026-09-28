import { describe, expect, it } from "vitest";
import {
  buildLocalClipPackage,
  type BuildHookPackageInput,
} from "@/lib/hookIntelligence";

const fixtures = [
  ["gaming", "If this push works we win the round", "The victory screen appears"],
  ["podcast", "Why did the launch fail in the first week", "The missing test caused it"],
  ["irl", "Wait what is that behind the door", "A rescued dog walks out"],
  ["reaction", "There is no way they actually built this", "The creator laughs at the reveal"],
  ["education", "Most people solve this equation backwards", "The shorter proof works"],
  ["coding", "I think I just found the memory leak", "The allocation graph drops"],
  ["interview", "Why did you leave the company", "She explains the final decision"],
  ["science", "This material should not bend like that", "The sample returns to shape"],
  ["commentary", "The headline leaves out the key detail", "The source shows the full context"],
] as const;

function benchmarkInput(
  category: string,
  hook: string,
  payoff: string,
  index: number
): BuildHookPackageInput {
  return {
    momentId: `benchmark-${index}`,
    contentCategory: category,
    title: `${hook} ${payoff}`.split(" ").slice(0, 9).join(" "),
    startTimeSeconds: 0,
    endTimeSeconds: 18,
    focusTimeSeconds: 10,
    momentQuality: 78,
    mode: "shadow",
    transcriptChunks: [
      { id: "hook", startTimeSeconds: 0.1, endTimeSeconds: 3, text: hook },
      { id: "setup", startTimeSeconds: 4, endTimeSeconds: 8, text: "Here is the context that makes it matter" },
      { id: "payoff", startTimeSeconds: 10, endTimeSeconds: 13, text: payoff },
      { id: "resolution", startTimeSeconds: 14, endTimeSeconds: 17, text: "That explains the result" },
    ],
    visualContext: {
      version: "visual-context-v2",
      sourceId: `source-${index}`,
      startTimeSeconds: 0,
      endTimeSeconds: 18,
      eventType: "benchmark",
      summary: payoff,
      events: [
        {
          timeSeconds: 10,
          type: "outcome",
          description: payoff,
          confidence: 0.86,
        },
      ],
      confidence: 0.82,
      uncertainties: [],
      sufficient: true,
      analysisLevel: "screenshots",
      modelVersion: "benchmark-fixture",
      evidence: [],
    },
  };
}

describe("hook engine representative benchmark", () => {
  it("produces grounded, reviewable packages across content categories", () => {
    const started = performance.now();
    const packages = fixtures.map(([category, hook, payoff], index) =>
      buildLocalClipPackage(benchmarkInput(category, hook, payoff, index))
    );
    expect(packages).toHaveLength(fixtures.length);
    for (const clipPackage of packages) {
      expect(clipPackage.hookCandidates.some((item) => item.hookType === "natural")).toBe(true);
      expect(clipPackage.selectedHook.reasoningEvidence.length).toBeGreaterThan(0);
      expect(clipPackage.selectedHook.misleadingHookRisk).toBeLessThan(40);
      expect(clipPackage.hookDNA.policyVersion).toBe("hook-policy-v1");
    }
    expect(performance.now() - started).toBeLessThan(250);
  });
});

