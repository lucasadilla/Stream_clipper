import { describe, expect, it } from "vitest";
import {
  platformPackagingCandidateSchema,
  rankPlatformPackagingCandidate,
} from "@/lib/packagingIntelligence";
import type { PlatformCopy } from "@/lib/platforms/types";

const context =
  "Tarik wins the Valorant round with one HP after hearing the reload.";

function copy(title: string): PlatformCopy {
  return {
    title,
    caption: null,
    postText: null,
    description: "The reload creates the only opening he needs.",
    hashtags: ["#Tarik", "#Valorant"],
    tags: ["Tarik Valorant"],
    quoteText: null,
    thumbnailText: null,
    pinnedComment: null,
  };
}

function candidate(title: string) {
  return platformPackagingCandidateSchema.parse({
    candidateId: title,
    strategy: "specific_fact",
    ...copy(title),
    evidence: ["hearing the reload"],
    specificity: 90,
    curiosity: 80,
    accuracy: 98,
    brevity: 90,
    naturalness: 92,
    keywordRelevance: 90,
    platformSuitability: 92,
    spoilerRisk: 10,
    clickbaitRisk: 2,
  });
}

describe("platform metadata ranking", () => {
  it("prefers a complete title that uses the central verified person", () => {
    const named = rankPlatformPackagingCandidate(
      candidate("Tarik hears the reload with one HP left"),
      copy("Tarik hears the reload with one HP left"),
      context,
      { importantEntities: ["Tarik", "Valorant"] }
    );
    const vague = rankPlatformPackagingCandidate(
      candidate("He hears the reload with one HP left"),
      copy("He hears the reload with one HP left"),
      context,
      { importantEntities: ["Tarik", "Valorant"] }
    );
    expect(named.rankScore).toBeGreaterThan(vague.rankScore);
    expect(vague.warnings).toContain(
      "Primary copy omits the strongest verified person or topic."
    );
  });

  it("strongly penalizes a title cut off on a dangling word", () => {
    const result = rankPlatformPackagingCandidate(
      candidate("Tarik explains the reason for the"),
      copy("Tarik explains the reason for the"),
      context,
      { importantEntities: ["Tarik"] }
    );
    expect(result.warnings).toContain(
      "Primary copy appears cut off or grammatically incomplete."
    );
    expect(result.rankScore).toBeLessThan(70);
  });
});
