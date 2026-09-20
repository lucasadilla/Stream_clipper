import { describe, expect, it } from "vitest";
import {
  narrativePlanQualityBonus,
  planNarrativeClip,
  type NarrativeTranscriptChunk,
} from "@/lib/narrativeBeats";
import { validateNarrativeChunkSelection } from "@/services/clipRankingService";

function chunks(
  entries: Array<[start: number, end: number, text: string]>
): NarrativeTranscriptChunk[] {
  return entries.map(([startTimeSeconds, endTimeSeconds, text], index) => ({
    id: `chunk_${index + 1}`,
    startTimeSeconds,
    endTimeSeconds,
    text,
  }));
}

const COMPLETE_STORY = chunks([
  [0, 5, "Why did our first launch completely fail?"],
  [5.1, 11, "For context, we had tested the product for three months."],
  [11.1, 17, "But the real problem was that nobody understood the first screen."],
  [17.1, 23, "Turns out, changing one sentence solved the problem."],
  [23.1, 27, "That is why the second launch finally worked."],
]);

describe("narrative beat planning", () => {
  it("builds a complete question-to-answer story around the signal", () => {
    const plan = planNarrativeClip({
      startTimeSeconds: 7,
      endTimeSeconds: 20,
      focusTimeSeconds: 14,
      transcriptChunks: COMPLETE_STORY,
      contentType: "podcast",
      source: "transcript_density",
      targetMinSeconds: 12,
      maximumDurationSeconds: 60,
    });

    expect(plan.startChunkId).toBe("chunk_1");
    expect(plan.endChunkId).toBe("chunk_5");
    expect(plan.arcType).toBe("question_answer");
    expect(plan.beats.map((beat) => beat.role)).toContain("hook");
    expect(plan.beats.map((beat) => beat.role)).toContain("payoff");
    expect(plan.endingComplete).toBe(true);
    expect(plan.accepted).toBe(true);
  });

  it("pulls in missing context instead of opening on a fragment", () => {
    const plan = planNarrativeClip({
      startTimeSeconds: 6,
      endTimeSeconds: 16,
      focusTimeSeconds: 10,
      transcriptChunks: chunks([
        [0, 5, "At first, we used the obvious strategy."],
        [5.1, 10, "But that failed because the timing was wrong."],
        [10.1, 16, "So we changed the timing and finally won."],
      ]),
      contentType: "talking",
      source: "transcript_density",
      targetMinSeconds: 10,
      maximumDurationSeconds: 45,
    });

    expect(plan.startChunkId).toBe("chunk_1");
    expect(plan.selectedText).toContain("At first");
    expect(plan.arcType).toBe("problem_solution");
  });

  it("rejects housekeeping instead of presenting it as a highlight", () => {
    const plan = planNarrativeClip({
      startTimeSeconds: 0,
      endTimeSeconds: 12,
      focusTimeSeconds: 6,
      transcriptChunks: chunks([
        [0, 5, "Welcome back everyone."],
        [5.1, 10, "Thanks for joining the stream."],
      ]),
      contentType: "talking",
      source: "even_sample",
      targetMinSeconds: 8,
      maximumDurationSeconds: 30,
    });

    expect(plan.accepted).toBe(false);
    expect(plan.rejectionReason).toBe("housekeeping_only");
    expect(narrativePlanQualityBonus(plan)).toBeLessThan(0);
  });

  it("keeps strong visual gaming signals when speech is unavailable", () => {
    const plan = planNarrativeClip({
      startTimeSeconds: 40,
      endTimeSeconds: 62,
      focusTimeSeconds: 54,
      transcriptChunks: [],
      contentType: "gaming",
      source: "event_window",
      targetMinSeconds: 12,
      maximumDurationSeconds: 45,
    });

    expect(plan.arcType).toBe("visual_payoff");
    expect(plan.accepted).toBe(true);
    expect(plan.startChunkId).toBeNull();
  });
});

describe("AI narrative boundary validation", () => {
  const candidate = {
    id: "candidate_1",
    startTimeSeconds: 5,
    endTimeSeconds: 23,
    focusTimeSeconds: 14,
    source: "transcript_density",
    currentTitle: "Why the First Launch Failed",
    context: COMPLETE_STORY.map((chunk) => chunk.text).join(" "),
    signalScore: 80,
    targetMinSeconds: 12,
    maximumDurationSeconds: 60,
    transcriptChunks: COMPLETE_STORY,
  };
  const scores = {
    hook: 88,
    payoff: 92,
    completeness: 96,
    standalone: 90,
    coherence: 91,
    pacing: 82,
    total: 91,
  };

  it("accepts grounded chronological beat and boundary choices", () => {
    const result = validateNarrativeChunkSelection(
      candidate,
      {
        startChunkId: "chunk_1",
        endChunkId: "chunk_5",
        focusChunkId: "chunk_3",
        arcType: "question_answer",
        beats: [
          {
            role: "hook",
            chunkId: "chunk_1",
            evidence: "first launch completely fail",
          },
          {
            role: "payoff",
            chunkId: "chunk_4",
            evidence: "changing one sentence solved the problem",
          },
          {
            role: "resolution",
            chunkId: "chunk_5",
            evidence: "second launch finally worked",
          },
        ],
        narrativeScores: scores,
      },
      "podcast"
    );

    expect(result?.startTimeSeconds).toBe(0);
    expect(result?.endTimeSeconds).toBeCloseTo(27.45);
    expect(result?.beats).toHaveLength(3);
  });

  it("rejects a model beat whose evidence came from another chunk", () => {
    const result = validateNarrativeChunkSelection(
      candidate,
      {
        startChunkId: "chunk_1",
        endChunkId: "chunk_5",
        focusChunkId: "chunk_3",
        arcType: "question_answer",
        beats: [
          {
            role: "hook",
            chunkId: "chunk_1",
            evidence: "first launch completely fail",
          },
          {
            role: "payoff",
            chunkId: "chunk_2",
            evidence: "changing one sentence solved the problem",
          },
        ],
        narrativeScores: scores,
      },
      "podcast"
    );

    expect(result).toBeNull();
  });
});
