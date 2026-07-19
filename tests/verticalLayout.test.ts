import { describe, expect, it } from "vitest";
import {
  buildSubjectCropPlan,
  candidateFromTrack,
  captionSafeZoneForLayout,
  classifyFacecamQuality,
  classifySourceFromTracks,
  computeTrackMetrics,
  parseVerticalLayoutRequest,
  recommendVerticalLayout,
  scoreEmbeddedFacecam,
  type FaceTrack,
  type FacecamCandidate,
} from "@/lib/verticalLayout";

function makeTrack(options: {
  id?: string;
  count: number;
  x: number;
  y: number;
  size?: number;
  jitter?: number;
  drift?: number;
  confidence?: number;
}): FaceTrack {
  const {
    id = "track-1",
    count,
    x,
    y,
    size = 0.08,
    jitter = 0,
    drift = 0,
    confidence = 0.9,
  } = options;
  const points = Array.from({ length: count }, (_, i) => ({
    timestampSeconds: i * 0.25,
    rect: {
      x: Math.min(1 - size, Math.max(0, x + drift * i + (i % 2 === 0 ? jitter : -jitter))),
      y,
      width: size,
      height: size,
    },
    confidence,
  }));
  return {
    id,
    points,
    firstSeenSeconds: 0,
    lastSeenSeconds: (count - 1) * 0.25,
    averageConfidence: confidence,
  };
}

describe("computeTrackMetrics", () => {
  it("gives a stable corner facecam high stability and edge affinity", () => {
    const track = makeTrack({ count: 40, x: 0.85, y: 0.75 });
    const metrics = computeTrackMetrics(track, 40);
    expect(metrics.persistence).toBe(1);
    expect(metrics.positionStability).toBeGreaterThan(0.9);
    expect(metrics.sizeStability).toBeGreaterThan(0.9);
    expect(metrics.edgeAffinity).toBeGreaterThan(0.5);
  });

  it("tracks movement for a drifting subject", () => {
    const moving = makeTrack({ count: 40, x: 0.1, y: 0.4, drift: 0.015 });
    const still = makeTrack({ count: 40, x: 0.1, y: 0.4 });
    expect(
      computeTrackMetrics(moving, 40).centerMovement
    ).toBeGreaterThan(computeTrackMetrics(still, 40).centerMovement);
  });

  it("scores mouth motion as speaking activity", () => {
    const talking = makeTrack({ count: 20, x: 0.3, y: 0.3, size: 0.25 });
    talking.points = talking.points.map((p, i) => ({
      ...p,
      mouthOpenRatio: 0.4 + (i % 2 === 0 ? 0.12 : 0),
    }));
    const quiet = makeTrack({ count: 20, x: 0.6, y: 0.3, size: 0.25 });
    quiet.points = quiet.points.map((p) => ({ ...p, mouthOpenRatio: 0.42 }));
    expect(computeTrackMetrics(talking, 20).speakingScore).toBeGreaterThan(
      computeTrackMetrics(quiet, 20).speakingScore
    );
  });
});

describe("classifySourceFromTracks", () => {
  it("classifies a stable corner face as embedded facecam", () => {
    const track = makeTrack({ count: 40, x: 0.85, y: 0.75 });
    const metrics = new Map([[track.id, computeTrackMetrics(track, 40)]]);
    const result = classifySourceFromTracks([track], metrics);
    expect(result.classification).toBe("embedded_facecam");
  });

  it("classifies a large moving face as moving subject", () => {
    const track = makeTrack({
      count: 40,
      x: 0.2,
      y: 0.3,
      size: 0.35,
      drift: 0.01,
    });
    const metrics = new Map([[track.id, computeTrackMetrics(track, 40)]]);
    const result = classifySourceFromTracks([track], metrics);
    expect(result.classification).toBe("moving_subject");
  });

  it("classifies two persistent faces as multiple faces", () => {
    const a = makeTrack({ id: "a", count: 40, x: 0.15, y: 0.4, size: 0.12 });
    const b = makeTrack({ id: "b", count: 36, x: 0.7, y: 0.4, size: 0.12 });
    const metrics = new Map([
      ["a", computeTrackMetrics(a, 40)],
      ["b", computeTrackMetrics(b, 40)],
    ]);
    const result = classifySourceFromTracks([a, b], metrics);
    expect(result.classification).toBe("multiple_faces");
  });

  it("classifies nothing as no face", () => {
    const result = classifySourceFromTracks([], new Map());
    expect(result.classification).toBe("no_face");
  });
});

describe("candidate scoring", () => {
  it("scores a persistent stable track higher than a flickery one", () => {
    const stable = computeTrackMetrics(
      makeTrack({ count: 40, x: 0.85, y: 0.75 }),
      40
    );
    const flickery = computeTrackMetrics(
      makeTrack({ count: 6, x: 0.4, y: 0.4, jitter: 0.05, confidence: 0.6 }),
      40
    );
    expect(scoreEmbeddedFacecam(stable)).toBeGreaterThan(
      scoreEmbeddedFacecam(flickery)
    );
  });

  it("builds candidates with expanded rects and pixel sizes", () => {
    const track = makeTrack({ count: 20, x: 0.8, y: 0.7 });
    const candidate = candidateFromTrack(
      track,
      computeTrackMetrics(track, 20),
      1920,
      1080
    );
    expect(candidate.rect.width).toBeGreaterThan(0.08);
    expect(candidate.sourceWidthPixels).toBeGreaterThan(0);
    expect(candidate.trackId).toBe(track.id);
  });
});

describe("classifyFacecamQuality", () => {
  it("classifies by source pixel size", () => {
    const bigRect = { x: 0, y: 0, width: 0.3, height: 0.3 };
    const tinyRect = { x: 0, y: 0, width: 0.04, height: 0.05 };
    expect(classifyFacecamQuality(1920, 1080, bigRect)).toBe("good");
    expect(classifyFacecamQuality(1920, 1080, tinyRect)).toBe("too_small");
  });
});

describe("recommendVerticalLayout", () => {
  const goodCandidate: FacecamCandidate = {
    trackId: "a",
    rect: { x: 0.7, y: 0.6, width: 0.25, height: 0.3 },
    confidence: 0.8,
    sourceWidthPixels: 480,
    sourceHeightPixels: 324,
    quality: "good",
    warnings: [],
  };

  it("recommends stacked for a good embedded facecam", () => {
    const rec = recommendVerticalLayout("embedded_facecam", goodCandidate);
    expect(rec.layout).toBe("facecam_top_gameplay_bottom");
  });

  it("recommends PiP for a low-resolution facecam", () => {
    const rec = recommendVerticalLayout("embedded_facecam", {
      ...goodCandidate,
      quality: "low_resolution",
    });
    expect(rec.layout).toBe("facecam_pip");
    expect(rec.warnings.join(" ")).toMatch(/blurry/i);
  });

  it("recommends subject crop for a moving subject", () => {
    const rec = recommendVerticalLayout("moving_subject", goodCandidate);
    expect(rec.layout).toBe("subject_aware_crop");
  });

  it("recommends center crop when no face exists", () => {
    const rec = recommendVerticalLayout("no_face", undefined);
    expect(rec.layout).toBe("center_crop");
  });

  it("recommends center crop for multiple faces without a clear speaker", () => {
    const rec = recommendVerticalLayout("multiple_faces", goodCandidate);
    expect(rec.layout).toBe("center_crop");
  });

  it("recommends Follow speaker when a clear speaker is detected among faces", () => {
    const rec = recommendVerticalLayout("multiple_faces", {
      ...goodCandidate,
      speakingScore: 0.55,
    });
    expect(rec.layout).toBe("subject_aware_crop");
  });
});

describe("buildSubjectCropPlan", () => {
  it("returns a centered plan when no points exist", () => {
    const plan = buildSubjectCropPlan([], 0, 10, 0.3);
    expect(plan).toHaveLength(1);
    expect(plan[0]!.centerX).toBe(0.5);
  });

  it("holds still inside the dead zone", () => {
    const points = Array.from({ length: 40 }, (_, i) => ({
      timestampSeconds: i * 0.25,
      rect: { x: 0.45 + (i % 2) * 0.01, y: 0.3, width: 0.2, height: 0.3 },
      confidence: 0.9,
    }));
    const plan = buildSubjectCropPlan(points, 0, 10, 0.4);
    // Tiny wobbles never leave the dead zone -> a single static keyframe.
    expect(plan.length).toBeLessThanOrEqual(2);
  });

  it("follows a large movement without jumping", () => {
    const points = Array.from({ length: 40 }, (_, i) => ({
      timestampSeconds: i * 0.25,
      rect: { x: i < 20 ? 0.05 : 0.7, y: 0.3, width: 0.2, height: 0.3 },
      confidence: 0.9,
    }));
    const plan = buildSubjectCropPlan(points, 0, 10, 0.3, {
      maxPanSpeed: 0.3,
    });
    expect(plan.length).toBeGreaterThan(1);
    for (let i = 1; i < plan.length; i++) {
      const dt = plan[i]!.timestampSeconds - plan[i - 1]!.timestampSeconds;
      const dx = Math.abs(plan[i]!.centerX - plan[i - 1]!.centerX);
      // Never faster than the configured max pan speed (with small tolerance).
      expect(dx).toBeLessThanOrEqual(0.3 * dt + 0.02);
    }
  });

  it("caps the number of keyframes", () => {
    const points = Array.from({ length: 2000 }, (_, i) => ({
      timestampSeconds: i * 0.25,
      rect: {
        x: 0.1 + 0.6 * Math.abs(Math.sin(i / 6)),
        y: 0.3,
        width: 0.2,
        height: 0.3,
      },
      confidence: 0.9,
    }));
    const plan = buildSubjectCropPlan(points, 0, 500, 0.3);
    expect(plan.length).toBeLessThanOrEqual(61);
  });
});

describe("captionSafeZoneForLayout", () => {
  it("keeps captions off a top facecam panel", () => {
    const zone = captionSafeZoneForLayout({
      layout: "facecam_top_gameplay_bottom",
      stackedFacecamPosition: "top",
      stackedFacecamHeightRatio: 0.4,
    });
    expect(zone.vertical).toBe("bottom");
  });

  it("raises captions above a bottom facecam panel", () => {
    const zone = captionSafeZoneForLayout({
      layout: "facecam_bottom_gameplay_top",
      stackedFacecamPosition: "bottom",
      stackedFacecamHeightRatio: 0.4,
    });
    expect(zone.vertical).toBe("bottom");
    expect(zone.verticalOffsetPercent).toBeGreaterThanOrEqual(40);
  });

  it("avoids a bottom PiP window", () => {
    const zone = captionSafeZoneForLayout({
      layout: "facecam_pip",
      pipPosition: "bottom_right",
    });
    expect(zone.verticalOffsetPercent).toBeGreaterThan(13);
  });
});

describe("parseVerticalLayoutRequest", () => {
  it("parses a minimal request with defaults", () => {
    const parsed = parseVerticalLayoutRequest({ layout: "facecam_pip" });
    expect(parsed).not.toBeNull();
    expect(parsed!.layout).toBe("facecam_pip");
    expect(parsed!.faceSelection.mode).toBe("auto");
  });

  it("rejects invalid manual rects", () => {
    const parsed = parseVerticalLayoutRequest({
      layout: "facecam_pip",
      faceSelection: {
        mode: "manual",
        manualRect: { x: -2, y: 0, width: 0.5, height: 0.5 },
      },
    });
    expect(parsed).toBeNull();
  });

  it("clamps out-of-range settings via schema bounds", () => {
    const parsed = parseVerticalLayoutRequest({
      layout: "facecam_top_gameplay_bottom",
      stacked: {
        facecamPosition: "top",
        facecamHeightRatio: 0.9,
        dividerSize: 0,
        dividerColor: "#000",
        hideOriginalFacecam: "none",
      },
    });
    // 0.9 is outside the 0.2..0.55 bounds -> request rejected, not silently accepted.
    expect(parsed).toBeNull();
  });
});
