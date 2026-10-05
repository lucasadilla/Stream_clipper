import type { PostRenderQualityReview } from "@/lib/postRenderCritic";
import type { VerticalLayoutRequest } from "@/lib/verticalLayout";

export interface AutomaticFramingRepairInput {
  format?: "vertical" | "native";
  qualityRepairPass?: number;
  verticalLayout?: VerticalLayoutRequest;
}

export interface AutomaticFramingRepair {
  qualityRepairPass: number;
  verticalLayout: VerticalLayoutRequest;
  reason: string;
}

/**
 * Produce one conservative retry for an AI-confirmed framing defect.
 * Creator-authored crops and gameplay compositions are never overwritten.
 */
export function planAutomaticFramingRepair(
  input: AutomaticFramingRepairInput,
  review: PostRenderQualityReview
): AutomaticFramingRepair | null {
  const layout = input.verticalLayout;
  if (
    input.format !== "vertical" ||
    !layout ||
    (input.qualityRepairPass ?? 0) >= 1 ||
    review.reviewer !== "ai_visual" ||
    layout.faceSelection.mode === "manual" ||
    (layout.reframe?.manualKeyframes?.length ?? 0) > 0
  ) {
    return null;
  }

  // A stacked/PiP/gameplay layout encodes an intentional two-region design.
  // Replacing it with a face-only crop could remove the play or screen context.
  if (
    layout.layout === "facecam_top_gameplay_bottom" ||
    layout.layout === "facecam_bottom_gameplay_top" ||
    layout.layout === "facecam_pip" ||
    layout.layout === "facecam_overlay" ||
    layout.layout === "gameplay_full"
  ) {
    return null;
  }

  const framingIssues = review.issues.filter(
    (issue) => issue.category === "framing" && issue.repairAction !== "none"
  );
  const actions = new Set(framingIssues.map((issue) => issue.repairAction));
  if (actions.size === 0) return null;

  if (actions.has("widen_context")) {
    return {
      qualityRepairPass: (input.qualityRepairPass ?? 0) + 1,
      reason: "The rendered review found missing visual context, so the retry uses a stable full-frame treatment.",
      verticalLayout: {
        ...layout,
        layout: "center_crop",
        faceSelection: { mode: "auto" },
        centerCrop: {
          focalPointX: layout.centerCrop?.focalPointX ?? 0.5,
          zoom: 1,
          useBlurredBackground: true,
        },
      },
    };
  }

  if (
    (actions.has("center_subject") || actions.has("follow_speaker")) &&
    layout.faceAnalysisJobId
  ) {
    return {
      qualityRepairPass: (input.qualityRepairPass ?? 0) + 1,
      reason: "The rendered review found an off-center or incorrect speaker crop, so the retry follows the verified face track with tighter centering.",
      verticalLayout: {
        ...layout,
        layout: "subject_aware_crop",
        faceSelection: { mode: "auto" },
        subjectCrop: {
          smoothing: Math.min(layout.subjectCrop?.smoothing ?? 0.35, 0.3),
          deadZoneRatio: Math.min(layout.subjectCrop?.deadZoneRatio ?? 0.5, 0.22),
          maxPanSpeed: Math.max(layout.subjectCrop?.maxPanSpeed ?? 0.35, 0.45),
          fallback: "hold",
        },
        reframe: {
          style: "professional",
          lockSubject: false,
          reactionEmphasis: layout.reframe?.reactionEmphasis ?? true,
        },
      },
    };
  }

  return null;
}
