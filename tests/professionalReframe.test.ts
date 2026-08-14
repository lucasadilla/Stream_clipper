import { describe, expect, it } from "vitest";
import {
  generateProfessionalReframePlan,
  rejectTrackOutliers,
  validateAndRepairCameraPlan,
  type CropKeyframe,
} from "@/lib/professionalReframe";
import { previewCameraFrameAt } from "@/lib/reframePlayback";
import type { FaceTrack } from "@/lib/verticalLayout";

function track(
  id: string,
  xAt: (index: number) => number,
  options: {
    count?: number;
    mouthAt?: (index: number) => number;
    confidenceAt?: (index: number) => number;
  } = {}
): FaceTrack {
  const count = options.count ?? 49;
  const points = Array.from({ length: count }, (_, index) => ({
    timestampSeconds: index * 0.25,
    rect: {
      x: xAt(index),
      y: 0.22,
      width: 0.18,
      height: 0.28,
    },
    confidence: options.confidenceAt?.(index) ?? 0.92,
    mouthOpenRatio: options.mouthAt?.(index) ?? 0.4,
  }));
  return {
    id,
    points,
    firstSeenSeconds: points[0]!.timestampSeconds,
    lastSeenSeconds: points[points.length - 1]!.timestampSeconds,
    averageConfidence: 0.92,
  };
}

function planFor(tracks: FaceTrack[], overrides = {}) {
  return generateProfessionalReframePlan({
    clipId: "clip-1",
    clipStartSeconds: 0,
    clipEndSeconds: 12,
    sourceWidth: 1920,
    sourceHeight: 1080,
    classification: tracks.length > 1 ? "multiple_faces" : "moving_subject",
    tracks,
    sampledFrames: 49,
    primaryTrackId: tracks[0]?.id,
    ...overrides,
  });
}

describe("professional reframe planning", () => {
  it("rejects one-frame detector spikes", () => {
    const noisy = track("creator", (index) => (index === 20 ? 0.78 : 0.35), {
      confidenceAt: (index) => (index === 20 ? 0.62 : 0.94),
    });
    const cleaned = rejectTrackOutliers(noisy);
    expect(cleaned.points.some((point) => point.rect.x > 0.7)).toBe(false);
  });

  it("holds a stable subject instead of following tiny face jitter", () => {
    const creator = track("creator", (index) => 0.36 + (index % 2 ? 0.006 : -0.006));
    const plan = planFor([creator], { style: "professional" });
    const movingFrames = plan.cropKeyframes.filter(
      (frame) => frame.reason === "subject_motion"
    );
    expect(movingFrames.length).toBeLessThanOrEqual(2);
    expect(plan.validation.valid).toBe(true);
  });

  it("cuts at a scene boundary instead of panning across unrelated scenes", () => {
    const creator = track("creator", (index) => (index < 24 ? 0.08 : 0.7));
    const plan = planFor([creator], {
      sceneChanges: [{ timestampSeconds: 6, score: 0.91 }],
    });
    const cut = plan.cropKeyframes.find(
      (frame) =>
        Math.abs(frame.timestampSeconds - 6) < 0.01 &&
        frame.reason === "scene_change"
    );
    expect(cut?.interpolation).toBe("cut");
  });

  it("keeps a locked creator even when another face has stronger mouth motion", () => {
    const creator = track("creator", () => 0.12, {
      mouthAt: () => 0.4,
    });
    const guest = track("guest", () => 0.68, {
      mouthAt: (index) => 0.36 + (index % 2 ? 0.17 : 0),
    });
    const plan = planFor([creator, guest], {
      lockedTrackId: "creator",
      primaryTrackId: "creator",
    });
    expect(plan.primarySubjectTrackIds).toEqual(["creator"]);
  });

  it("uses manual crop keyframes as authoritative edits", () => {
    const creator = track("creator", () => 0.35);
    const plan = planFor([creator], {
      manualKeyframes: [
        {
          timestampSeconds: 4,
          centerX: 0.72,
          centerY: 0.5,
          cropWidth: 0.3,
          cropHeight: 1,
          interpolation: "cut",
        },
      ],
    });
    const manual = plan.cropKeyframes.find(
      (frame) => frame.reason === "manual_override"
    );
    expect(manual?.timestampSeconds).toBe(4);
    expect(manual?.centerX).toBeCloseTo(0.72);
  });

  it("repairs out-of-bounds and overly fast crop movement", () => {
    const frames: CropKeyframe[] = [
      {
        timestampSeconds: 0,
        centerX: 0.2,
        centerY: 0.5,
        cropWidth: 0.3,
        cropHeight: 1,
        interpolation: "hold",
        reason: "initial_composition",
        confidence: 1,
      },
      {
        timestampSeconds: 0.2,
        centerX: 1.2,
        centerY: 0.1,
        cropWidth: 0.3,
        cropHeight: 1,
        interpolation: "ease_in_out",
        reason: "subject_motion",
        confidence: 1,
      },
    ];
    const result = validateAndRepairCameraPlan(frames);
    expect(result.validation.repaired).toBe(true);
    expect(result.keyframes[1]!.centerX).toBeLessThan(0.3);
    expect(result.keyframes[1]!.centerY).toBe(0.5);
  });
});

describe("preview camera interpolation", () => {
  it("uses the same eased movement encoded for FFmpeg", () => {
    const frame = previewCameraFrameAt(
      [
        { timestampSeconds: 0, centerX: 0.2, centerY: 0.5 },
        {
          timestampSeconds: 4,
          centerX: 0.8,
          centerY: 0.5,
          interpolation: "ease_in_out",
        },
      ],
      1
    );
    // Cubic smoothstep at 25% is 15.625%, not a linear 25% move.
    expect(frame?.centerX).toBeCloseTo(0.29375, 4);
  });

  it("holds the old composition until a cut keyframe", () => {
    const before = previewCameraFrameAt(
      [
        { timestampSeconds: 0, centerX: 0.2 },
        { timestampSeconds: 4, centerX: 0.8, interpolation: "cut" },
      ],
      3.99
    );
    const after = previewCameraFrameAt(
      [
        { timestampSeconds: 0, centerX: 0.2 },
        { timestampSeconds: 4, centerX: 0.8, interpolation: "cut" },
      ],
      4
    );
    expect(before?.centerX).toBe(0.2);
    expect(after?.centerX).toBe(0.8);
  });
});

