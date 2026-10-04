import { describe, expect, it } from "vitest";
import {
  buildContextAwareFramingPlan,
  contextAwareCropKeyframesForRange,
} from "@/lib/contextAwareFraming";
import type { GameplayImportanceMap } from "@/lib/gameplayLayout";
import type { CropKeyframe } from "@/lib/professionalReframe";
import { previewCameraFrameAt } from "@/lib/reframePlayback";

const baseKeyframes: CropKeyframe[] = [
  {
    timestampSeconds: 0,
    centerX: 0.24,
    centerY: 0.5,
    cropWidth: 0.32,
    cropHeight: 1,
    interpolation: "hold",
    reason: "initial_composition",
    subjectTrackId: "speaker-left",
    confidence: 0.9,
  },
  {
    timestampSeconds: 8,
    centerX: 0.76,
    centerY: 0.5,
    cropWidth: 0.32,
    cropHeight: 1,
    interpolation: "cut",
    reason: "speaker_change",
    subjectTrackId: "speaker-right",
    confidence: 0.91,
  },
];

function importanceMap(
  evidence = ["multimodal_context:visual_focus"]
): GameplayImportanceMap {
  return {
    version: "gameplay-layout-v2",
    clipStartSeconds: 100,
    clipEndSeconds: 112,
    sourceWidth: 1920,
    sourceHeight: 1080,
    regions: [
      {
        id: "object-at-right",
        startTimeSeconds: 103,
        endTimeSeconds: 104.2,
        rect: { x: 0.74, y: 0.25, width: 0.18, height: 0.3 },
        category: "visual_focus",
        strength: 0.94,
        confidence: 0.92,
        evidence,
      },
    ],
    sceneChanges: [],
    confidence: 0.84,
    temporalCoverage: 0.3,
    conservativeFallback: false,
  };
}

describe("context-aware framing", () => {
  it("temporarily focuses a grounded visual reference, then returns to the speaker plan", () => {
    const plan = buildContextAwareFramingPlan({
      clipStartSeconds: 100,
      clipEndSeconds: 112,
      baseKeyframes,
      importanceMap: importanceMap(),
      transcript: [
        {
          startTimeSeconds: 102.8,
          endTimeSeconds: 104,
          text: "Look at that item on the right.",
        },
      ],
      sampledFrameTimestamps: [100, 101, 102, 103, 104, 105],
      activeSpeakerDecisionCount: 48,
    });

    expect(plan.mode).toBe("speaker_and_visual_context");
    expect(plan.visualTargets).toHaveLength(1);
    const focus = plan.cropKeyframes.find(
      (frame) => frame.reason === "visual_focus"
    );
    expect(focus?.centerX).toBeGreaterThan(0.75);
    const after = previewCameraFrameAt(plan.cropKeyframes, 5.2);
    expect(after?.centerX).toBeLessThan(0.5);
    expect(plan.sampleCadenceSeconds).toBe(1);
  });

  it("does not let local motion guesses override the active speaker", () => {
    const plan = buildContextAwareFramingPlan({
      clipStartSeconds: 100,
      clipEndSeconds: 112,
      baseKeyframes,
      importanceMap: importanceMap(["local_cv:visual_focus"]),
      activeSpeakerDecisionCount: 48,
    });

    expect(plan.mode).toBe("active_speaker");
    expect(plan.visualTargets).toHaveLength(0);
    expect(
      plan.cropKeyframes.some((frame) => frame.reason === "visual_focus")
    ).toBe(false);
  });

  it("follows a meaningful cursor target without chasing nearby pointer jitter", () => {
    const map = importanceMap();
    map.regions = [
      {
        ...map.regions[0]!,
        id: "cursor-target-a",
        startTimeSeconds: 102,
        endTimeSeconds: 103.2,
        rect: { x: 0.68, y: 0.2, width: 0.2, height: 0.26 },
        attentionSource: "cursor_target",
        cursorAction: "clicking",
        layoutHint: "screen_focus",
        evidence: [
          "multimodal_context:action",
          "multimodal_attention:cursor_target",
          "cursor_action:clicking",
        ],
      },
      {
        ...map.regions[0]!,
        id: "cursor-target-jitter",
        startTimeSeconds: 103,
        endTimeSeconds: 104.1,
        rect: { x: 0.72, y: 0.22, width: 0.2, height: 0.26 },
        attentionSource: "cursor_target",
        cursorAction: "moving",
        layoutHint: "screen_focus",
        evidence: [
          "multimodal_context:action",
          "multimodal_attention:cursor_target",
          "cursor_action:moving",
        ],
      },
    ];

    const plan = buildContextAwareFramingPlan({
      clipStartSeconds: 100,
      clipEndSeconds: 112,
      baseKeyframes,
      importanceMap: map,
      activeSpeakerDecisionCount: 48,
    });

    expect(plan.visualTargets).toHaveLength(1);
    expect(plan.compositionTemplate).toBe("screen_focus");
    expect(plan.maxPrimaryRegions).toBe(2);
    expect(
      plan.cropKeyframes.filter((frame) => frame.reason === "visual_focus")
    ).toHaveLength(1);
  });

  it("ignores an idle cursor and preserves the speaker composition", () => {
    const map = importanceMap();
    map.regions[0] = {
      ...map.regions[0]!,
      attentionSource: "cursor_target",
      cursorAction: "idle",
      layoutHint: "screen_focus",
      evidence: [
        "multimodal_context:context",
        "multimodal_attention:cursor_target",
        "cursor_action:idle",
      ],
    };
    const plan = buildContextAwareFramingPlan({
      clipStartSeconds: 100,
      clipEndSeconds: 112,
      baseKeyframes,
      importanceMap: map,
      activeSpeakerDecisionCount: 48,
    });

    expect(plan.visualTargets).toHaveLength(0);
    expect(plan.cropKeyframes.some((frame) => frame.reason === "visual_focus"))
      .toBe(false);
  });

  it("rebases the same stored camera plan when a clip is trimmed", () => {
    const plan = buildContextAwareFramingPlan({
      clipStartSeconds: 100,
      clipEndSeconds: 112,
      baseKeyframes,
      importanceMap: importanceMap(),
      transcript: [
        {
          startTimeSeconds: 103,
          endTimeSeconds: 104,
          text: "You can see this right here.",
        },
      ],
      activeSpeakerDecisionCount: 48,
    });
    const expectedOpening = previewCameraFrameAt(plan.cropKeyframes, 2);
    const trimmed = contextAwareCropKeyframesForRange({
      plan,
      startTimeSeconds: 102,
      endTimeSeconds: 110,
    });

    expect(trimmed[0]?.timestampSeconds).toBe(0);
    expect(trimmed[0]?.centerX).toBeCloseTo(expectedOpening?.centerX ?? 0, 5);
    expect(trimmed.every((frame) => frame.timestampSeconds <= 8.05)).toBe(true);
  });
});
