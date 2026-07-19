import { describe, expect, it } from "vitest";
import { buildFaceTracks } from "@/lib/faceTracking";
import type { FaceDetection } from "@/lib/verticalLayout";

function detection(
  t: number,
  x: number,
  y: number,
  size = 0.1,
  confidence = 0.9
): FaceDetection {
  return {
    timestampSeconds: t,
    rect: { x, y, width: size, height: size },
    confidence,
  };
}

describe("buildFaceTracks", () => {
  it("groups a stable face into one track", () => {
    const detections = Array.from({ length: 10 }, (_, i) =>
      detection(i * 0.25, 0.8, 0.7)
    );
    const tracks = buildFaceTracks(detections);
    expect(tracks).toHaveLength(1);
    expect(tracks[0]!.points).toHaveLength(10);
    expect(tracks[0]!.averageConfidence).toBeCloseTo(0.9);
  });

  it("keeps two simultaneous faces on separate tracks", () => {
    const detections: FaceDetection[] = [];
    for (let i = 0; i < 8; i++) {
      detections.push(detection(i * 0.25, 0.1, 0.1));
      detections.push(detection(i * 0.25, 0.7, 0.6));
    }
    const tracks = buildFaceTracks(detections);
    expect(tracks).toHaveLength(2);
    expect(tracks[0]!.points).toHaveLength(8);
    expect(tracks[1]!.points).toHaveLength(8);
  });

  it("bridges short disappearances within the gap window", () => {
    const detections = [
      detection(0, 0.5, 0.5),
      detection(0.25, 0.5, 0.5),
      // 2-second gap (below the 2.5s default limit)
      detection(2.25, 0.5, 0.5),
    ];
    const tracks = buildFaceTracks(detections);
    expect(tracks).toHaveLength(1);
    expect(tracks[0]!.points).toHaveLength(3);
  });

  it("starts a new track after a long disappearance", () => {
    const detections = [
      detection(0, 0.5, 0.5),
      detection(5, 0.5, 0.5), // beyond the gap window
    ];
    const tracks = buildFaceTracks(detections);
    expect(tracks).toHaveLength(2);
  });

  it("splits tracks when the face jumps across the frame", () => {
    const detections = [
      detection(0, 0.1, 0.1),
      detection(0.25, 0.85, 0.85),
    ];
    const tracks = buildFaceTracks(detections);
    expect(tracks).toHaveLength(2);
  });

  it("drops low-confidence detections", () => {
    const detections = [
      detection(0, 0.5, 0.5, 0.1, 0.2),
      detection(0.25, 0.5, 0.5, 0.1, 0.9),
    ];
    const tracks = buildFaceTracks(detections);
    expect(tracks).toHaveLength(1);
    expect(tracks[0]!.points).toHaveLength(1);
  });

  it("rejects size mismatches as different faces", () => {
    const detections = [
      detection(0, 0.5, 0.5, 0.05),
      detection(0.25, 0.5, 0.5, 0.3),
    ];
    const tracks = buildFaceTracks(detections);
    expect(tracks).toHaveLength(2);
  });
});
