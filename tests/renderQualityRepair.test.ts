import { describe, expect, it } from "vitest";
import type { PostRenderQualityReview } from "@/lib/postRenderCritic";
import { planAutomaticFramingRepair } from "@/lib/renderQualityRepair";

function review(repairAction: "center_subject" | "follow_speaker" | "widen_context"): PostRenderQualityReview {
  return {
    version: 1,
    verdict: "review",
    score: 72,
    summary: "The subject is visibly outside the intended composition.",
    scores: {
      framing: 58,
      captions: 95,
      cuts: 95,
      clarity: 90,
      platformReadiness: 76,
    },
    issues: [
      {
        severity: "warning",
        category: "framing",
        timestampSeconds: 2,
        title: "Subject is off center",
        evidence: "The visible speaker is pressed against the left edge.",
        recommendation: "Recenter the tracked speaker.",
        repairAction,
      },
    ],
    strengths: [],
    reviewer: "ai_visual",
    model: "vision-test",
    samplesReviewed: 6,
    reviewedAt: new Date(0).toISOString(),
  };
}

const automaticLayout = {
  layout: "auto" as const,
  faceAnalysisJobId: "face-job",
  faceSelection: { mode: "auto" as const },
};

describe("automatic rendered-frame repair", () => {
  it("retries an off-center automatic crop with tighter face tracking", () => {
    const repair = planAutomaticFramingRepair(
      { format: "vertical", verticalLayout: automaticLayout },
      review("center_subject")
    );
    expect(repair?.verticalLayout.layout).toBe("subject_aware_crop");
    expect(repair?.verticalLayout.subjectCrop?.deadZoneRatio).toBeLessThanOrEqual(0.22);
    expect(repair?.qualityRepairPass).toBe(1);
  });

  it("uses a stable wide treatment when the critic finds missing context", () => {
    const repair = planAutomaticFramingRepair(
      { format: "vertical", verticalLayout: automaticLayout },
      review("widen_context")
    );
    expect(repair?.verticalLayout.layout).toBe("center_crop");
    expect(repair?.verticalLayout.centerCrop?.useBlurredBackground).toBe(true);
  });

  it("never overwrites a manual crop or loops through repeated repairs", () => {
    expect(
      planAutomaticFramingRepair(
        {
          format: "vertical",
          verticalLayout: {
            ...automaticLayout,
            faceSelection: {
              mode: "manual",
              manualRect: { x: 0.1, y: 0.1, width: 0.3, height: 0.3 },
            },
          },
        },
        review("center_subject")
      )
    ).toBeNull();
    expect(
      planAutomaticFramingRepair(
        { format: "vertical", verticalLayout: automaticLayout, qualityRepairPass: 1 },
        review("center_subject")
      )
    ).toBeNull();
  });
});
