import { describe, expect, it } from "vitest";
import {
  buildGameplayImportanceMap,
  planGameplayLayout,
  type GameplaySignal,
} from "@/lib/gameplayLayout";
import type {
  FaceSourceClassification,
  FaceTrack,
  FacecamCandidate,
} from "@/lib/verticalLayout";

const normalFacecam: FacecamCandidate = {
  trackId: "creator",
  rect: { x: 0.79, y: 0.03, width: 0.18, height: 0.24 },
  faceRect: { x: 0.84, y: 0.07, width: 0.08, height: 0.1 },
  confidence: 0.92,
  sourceWidthPixels: 346,
  sourceHeightPixels: 259,
  quality: "good",
  warnings: [],
  speakingScore: 0.7,
};

const creatorTrack: FaceTrack = {
  id: "creator",
  firstSeenSeconds: 0,
  lastSeenSeconds: 10,
  averageConfidence: 0.92,
  points: Array.from({ length: 21 }, (_, index) => ({
    timestampSeconds: index * 0.5,
    rect: normalFacecam.faceRect!,
    confidence: 0.92,
    speakingActivity: index >= 10 && index <= 15 ? 0.88 : 0.18,
    mouthOpenRatio: index >= 10 && index <= 15 ? 0.8 : 0.16,
    audioActivity: index >= 10 && index <= 15 ? 0.78 : 0.22,
  })),
};

function samples(
  positions: Array<{ x: number; y: number; width?: number; category?: "action" | "hud" | "visual_focus" }>
): GameplaySignal[] {
  return positions.map((position, index) => ({
    timestampSeconds: index + 0.5,
    sceneChange: index === Math.floor(positions.length / 2),
    regions: [
      {
        rect: {
          x: position.x,
          y: position.y,
          width: position.width ?? 0.22,
          height: 0.28,
        },
        category: position.category ?? "action",
        strength: 0.9,
        confidence: 0.88,
      },
    ],
  }));
}

const scenarios: Array<{
  name: string;
  sourceWidth: number;
  sourceHeight: number;
  classification: FaceSourceClassification;
  facecam?: FacecamCandidate;
  signals: GameplaySignal[];
}> = [
  {
    name: "fps center action",
    sourceWidth: 1920,
    sourceHeight: 1080,
    classification: "embedded_facecam",
    facecam: normalFacecam,
    signals: samples([
      { x: 0.36, y: 0.32 },
      { x: 0.4, y: 0.3 },
      { x: 0.45, y: 0.34 },
      { x: 0.42, y: 0.29 },
      { x: 0.38, y: 0.33 },
    ]),
  },
  {
    name: "racing road and standings",
    sourceWidth: 1920,
    sourceHeight: 1080,
    classification: "embedded_facecam",
    facecam: normalFacecam,
    signals: samples([
      { x: 0.36, y: 0.5 },
      { x: 0.39, y: 0.48 },
      { x: 0.03, y: 0.12, category: "hud", width: 0.16 },
      { x: 0.42, y: 0.5 },
    ]),
  },
  {
    name: "strategy distributed UI",
    sourceWidth: 2560,
    sourceHeight: 1440,
    classification: "embedded_facecam",
    facecam: normalFacecam,
    signals: samples([
      { x: 0.02, y: 0.08, category: "hud", width: 0.24 },
      { x: 0.7, y: 0.12, category: "hud", width: 0.24 },
      { x: 0.4, y: 0.5, category: "visual_focus", width: 0.3 },
      { x: 0.06, y: 0.62, category: "hud", width: 0.22 },
    ]),
  },
  {
    name: "no webcam gameplay",
    sourceWidth: 1920,
    sourceHeight: 1080,
    classification: "gameplay_only",
    signals: samples([
      { x: 0.12, y: 0.3 },
      { x: 0.28, y: 0.32 },
      { x: 0.54, y: 0.28 },
      { x: 0.66, y: 0.34 },
    ]),
  },
  {
    name: "small webcam",
    sourceWidth: 1920,
    sourceHeight: 1080,
    classification: "embedded_facecam",
    facecam: {
      ...normalFacecam,
      sourceWidthPixels: 145,
      sourceHeightPixels: 92,
      quality: "too_small",
    },
    signals: samples([
      { x: 0.3, y: 0.25 },
      { x: 0.38, y: 0.3 },
      { x: 0.44, y: 0.34 },
    ]),
  },
  {
    name: "edge HUD",
    sourceWidth: 1920,
    sourceHeight: 1080,
    classification: "embedded_facecam",
    facecam: normalFacecam,
    signals: samples([
      { x: 0.01, y: 0.08, category: "hud", width: 0.18 },
      { x: 0.79, y: 0.1, category: "hud", width: 0.18 },
      { x: 0.38, y: 0.35, category: "action" },
    ]),
  },
  {
    name: "low resolution source",
    sourceWidth: 854,
    sourceHeight: 480,
    classification: "embedded_facecam",
    facecam: {
      ...normalFacecam,
      sourceWidthPixels: 154,
      sourceHeightPixels: 115,
      quality: "low_resolution",
    },
    signals: samples([
      { x: 0.32, y: 0.3 },
      { x: 0.42, y: 0.32 },
      { x: 0.5, y: 0.35 },
    ]),
  },
];

describe("gameplay layout benchmark matrix", () => {
  it("keeps all representative genres inside hard constraints", () => {
    const started = performance.now();
    for (const scenario of scenarios) {
      const map = buildGameplayImportanceMap({
        clipStartSeconds: 0,
        clipEndSeconds: 10,
        sourceWidth: scenario.sourceWidth,
        sourceHeight: scenario.sourceHeight,
        facecamRect: scenario.facecam?.rect,
        signals: scenario.signals,
      });
      const plan = planGameplayLayout({
        map,
        sourceWidth: scenario.sourceWidth,
        sourceHeight: scenario.sourceHeight,
        classification: scenario.classification,
        facecam: scenario.facecam,
        tracks: scenario.facecam ? [creatorTrack] : [],
        primaryTrackId: scenario.facecam ? "creator" : undefined,
      });
      const selected = plan.candidates.find(
        (candidate) => candidate.id === plan.selectedCandidateId
      );
      expect(selected, scenario.name).toBeDefined();
      expect(selected?.validation.valid, scenario.name).toBe(true);
      expect(plan.gameplayCropKeyframes.length, scenario.name).toBeLessThanOrEqual(40);
      expect(plan.segments.length, scenario.name).toBeLessThanOrEqual(7);
      if (map.confidence >= 0.5) {
        expect(
          selected?.validation.gameplayCoverage ?? 0,
          scenario.name
        ).toBeGreaterThanOrEqual(0.66);
      }
      if (!scenario.facecam) {
        expect(["gameplay_only", "conservative"], scenario.name).toContain(
          plan.selectedFamily
        );
      }
      if (scenario.facecam?.quality === "too_small") {
        expect(plan.selectedFamily, scenario.name).not.toBe("stacked");
      }
    }
    expect(performance.now() - started).toBeLessThan(1_500);
  });
});
