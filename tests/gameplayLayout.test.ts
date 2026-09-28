import { describe, expect, it } from "vitest";
import {
  buildGameplayCropKeyframes,
  buildGameplayImportanceMap,
  generateGameplayLayoutCandidates,
  planGameplayLayout,
  verticalLayoutForAutomaticPlan,
  type GameplaySignal,
} from "@/lib/gameplayLayout";
import type { FaceTrack, FacecamCandidate } from "@/lib/verticalLayout";

const source = { sourceWidth: 1920, sourceHeight: 1080 };

function signal(
  timestampSeconds: number,
  x: number,
  category: "action" | "hud" | "visual_focus" = "action",
  sceneChange = false
): GameplaySignal {
  return {
    timestampSeconds,
    sceneChange,
    regions: [
      {
        rect: { x, y: 0.25, width: 0.25, height: 0.34 },
        strength: 0.9,
        confidence: 0.88,
        category,
      },
    ],
  };
}

const facecam: FacecamCandidate = {
  trackId: "creator",
  rect: { x: 0.78, y: 0.02, width: 0.2, height: 0.25 },
  faceRect: { x: 0.83, y: 0.06, width: 0.09, height: 0.12 },
  confidence: 0.91,
  sourceWidthPixels: 384,
  sourceHeightPixels: 270,
  quality: "good",
  warnings: [],
  speakingScore: 0.8,
};

function creatorTrack(reaction = false): FaceTrack {
  const points = Array.from({ length: 25 }, (_, index) => ({
    timestampSeconds: index * 0.5,
    rect: facecam.faceRect!,
    confidence: 0.93,
    speakingActivity: reaction && index >= 12 && index <= 17 ? 0.9 : 0.2,
    mouthOpenRatio: reaction && index >= 12 && index <= 17 ? 0.85 : 0.2,
    audioActivity: reaction && index >= 12 && index <= 17 ? 0.8 : 0.25,
  }));
  return {
    id: "creator",
    points,
    firstSeenSeconds: 0,
    lastSeenSeconds: 12,
    averageConfidence: 0.93,
  };
}

describe("gameplay importance and layout planning", () => {
  it("keeps face tracking when gameplay evidence is conservative", () => {
    expect(
      verticalLayoutForAutomaticPlan("conservative", "center_crop", true)
    ).toBe("subject_aware_crop");
    expect(
      verticalLayoutForAutomaticPlan("stacked", "subject_aware_crop")
    ).toBe("facecam_top_gameplay_bottom");
  });

  it("reduces false gameplay importance inside the detected webcam", () => {
    const webcamSignal = signal(1, 0.76);
    webcamSignal.regions[0]!.rect.y = 0.02;
    webcamSignal.regions[0]!.rect.height = 0.25;
    const map = buildGameplayImportanceMap({
      clipStartSeconds: 0,
      clipEndSeconds: 4,
      ...source,
      facecamRect: facecam.rect,
      signals: [webcamSignal, signal(2, 0.35), signal(3, 0.35)],
    });
    const webcamRegion = map.regions.find((region) =>
      region.evidence.includes("overlaps_webcam")
    );
    const gameplayRegion = map.regions.find((region) => region.rect.x < 0.5);
    expect(webcamRegion?.strength ?? 1).toBeLessThan(gameplayRegion?.strength ?? 0);
  });

  it("uses timestamped multimodal gameplay regions as structured evidence", () => {
    const map = buildGameplayImportanceMap({
      clipStartSeconds: 10,
      clipEndSeconds: 15,
      ...source,
      visualEvents: [
        {
          startTimeSeconds: 10,
          endTimeSeconds: 15,
          type: "contextual_analysis",
          score: 8,
          rawData: {
            context: {
              events: [
                {
                  timeSeconds: 12,
                  type: "outcome",
                  importanceRegions: [
                    {
                      rect: { x: 0.7, y: 0.08, width: 0.24, height: 0.2 },
                      category: "outcome",
                      strength: 0.95,
                    },
                  ],
                },
              ],
            },
          },
        },
      ],
    });
    const outcome = map.regions.find((region) => region.category === "outcome");
    expect(outcome?.startTimeSeconds).toBeCloseTo(11.25);
    expect(outcome?.rect.x).toBeCloseTo(0.7);
    expect(outcome?.evidence).toContain("multimodal_context:outcome");
  });

  it("moves toward action and cuts at real scene changes", () => {
    const map = buildGameplayImportanceMap({
      clipStartSeconds: 10,
      clipEndSeconds: 18,
      ...source,
      signals: [
        signal(10, 0.05),
        signal(12, 0.08),
        signal(15, 0.7, "action", true),
        signal(17, 0.68),
      ],
    });
    const keyframes = buildGameplayCropKeyframes(map, 0.34);
    expect(keyframes[0]?.timestampSeconds).toBe(0);
    expect(keyframes.some((frame) => frame.centerX < 0.4)).toBe(true);
    expect(
      keyframes.some(
        (frame) => frame.interpolation === "cut" && frame.centerX > 0.65
      )
    ).toBe(true);
  });

  it("places PiP away from strong gameplay regions", () => {
    const map = buildGameplayImportanceMap({
      clipStartSeconds: 0,
      clipEndSeconds: 6,
      ...source,
      signals: [signal(1, 0.68), signal(3, 0.7), signal(5, 0.68)],
    });
    const pip = generateGameplayLayoutCandidates({
      map,
      ...source,
      classification: "embedded_facecam",
      facecam,
      primaryTrack: creatorTrack(),
    }).filter((candidate) => candidate.family === "pip");
    expect(pip[0]?.pipPosition).toBe("top_left");
    expect(pip[0]?.score ?? 0).toBeGreaterThan(pip.at(-1)?.score ?? 1);
  });

  it("uses gameplay-only framing when no useful webcam exists", () => {
    const map = buildGameplayImportanceMap({
      clipStartSeconds: 0,
      clipEndSeconds: 8,
      ...source,
      signals: [signal(1, 0.1), signal(3, 0.35), signal(5, 0.62), signal(7, 0.64)],
    });
    const plan = planGameplayLayout({
      map,
      ...source,
      classification: "gameplay_only",
      tracks: [],
    });
    expect(plan.selectedFamily).toBe("gameplay_only");
    expect(plan.gameplayCropKeyframes.length).toBeGreaterThan(1);
  });

  it("falls back to full context when visual evidence is missing", () => {
    const map = buildGameplayImportanceMap({
      clipStartSeconds: 0,
      clipEndSeconds: 12,
      ...source,
    });
    const plan = planGameplayLayout({
      map,
      ...source,
      classification: "no_face",
      tracks: [],
    });
    expect(map.conservativeFallback).toBe(true);
    expect(plan.selectedFamily).toBe("conservative");
  });

  it("keeps reaction emphasis restrained and time-aligned", () => {
    const map = buildGameplayImportanceMap({
      clipStartSeconds: 0,
      clipEndSeconds: 12,
      ...source,
      signals: Array.from({ length: 12 }, (_, index) =>
        signal(index + 0.5, 0.35)
      ),
    });
    const plan = planGameplayLayout({
      map,
      ...source,
      classification: "embedded_facecam",
      facecam,
      tracks: [creatorTrack(true)],
      primaryTrackId: "creator",
    });
    if (plan.selectedFamily === "dynamic_reaction") {
      expect(plan.segments.some((segment) => segment.family === "stacked")).toBe(true);
      expect(plan.segments.length).toBeLessThanOrEqual(5);
    } else {
      expect(
        plan.candidates.find((candidate) => candidate.family === "dynamic_reaction")
          ?.score ?? 0
      ).toBeGreaterThan(0);
    }
  });
});
