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

function appearance(index: number): number[] {
  return Array.from({ length: 8 }, (_, item) => (item === index ? 1 : 0));
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

  it("uses motion prediction to preserve identity during a fast pan", () => {
    const detections = [
      detection(0, 0.1, 0.3, 0.12),
      detection(0.25, 0.16, 0.3, 0.12),
      detection(0.5, 0.26, 0.3, 0.12),
    ];
    const tracks = buildFaceTracks(detections);
    expect(tracks).toHaveLength(1);
    expect(tracks[0]!.points).toHaveLength(3);
  });

  it("preserves worker speaking activity on the resulting track", () => {
    const tracks = buildFaceTracks([
      {
        ...detection(0, 0.3, 0.3),
        speakingActivity: 0.72,
        audioActivity: 0.81,
      },
      {
        ...detection(0.25, 0.3, 0.3),
        speakingActivity: 0.64,
        audioActivity: 0.7,
      },
    ]);
    expect(tracks[0]!.points[0]!.speakingActivity).toBe(0.72);
    expect(tracks[0]!.points[1]!.speakingActivity).toBe(0.64);
    expect(tracks[0]!.points[0]!.audioActivity).toBe(0.81);
  });

  it("uses clip-local appearance to preserve identities when faces cross", () => {
    const detections: FaceDetection[] = [];
    const samples = [
      [0, 0.1, 0.7],
      [0.25, 0.2, 0.6],
      [0.5, 0.32, 0.48],
      [0.75, 0.44, 0.36],
      [1, 0.56, 0.24],
    ];
    for (const [time, firstX, secondX] of samples) {
      detections.push({
        ...detection(time, firstX, 0.3, 0.12),
        appearanceDescriptor: appearance(0),
      });
      // Reverse array order around the crossing so input order cannot preserve
      // identity by accident.
      detections.unshift({
        ...detection(time, secondX, 0.3, 0.12),
        appearanceDescriptor: appearance(1),
      });
    }

    const tracks = buildFaceTracks(detections);
    expect(tracks).toHaveLength(2);
    const firstIdentity = tracks.find(
      (track) => track.points[0]!.rect.x < 0.2
    )!;
    const secondIdentity = tracks.find(
      (track) => track.points[0]!.rect.x > 0.6
    )!;
    expect(firstIdentity.points).toHaveLength(5);
    expect(secondIdentity.points).toHaveLength(5);
    expect(firstIdentity.points.at(-1)!.rect.x).toBeGreaterThan(0.5);
    expect(secondIdentity.points.at(-1)!.rect.x).toBeLessThan(0.3);
  });

  it("does not merge different-looking faces at the same position", () => {
    const tracks = buildFaceTracks([
      {
        ...detection(0, 0.4, 0.3),
        appearanceDescriptor: appearance(0),
      },
      {
        ...detection(0.25, 0.4, 0.3),
        appearanceDescriptor: appearance(1),
      },
    ]);
    expect(tracks).toHaveLength(2);
  });

  it("continues an established track with a lower-confidence detection", () => {
    const tracks = buildFaceTracks([
      detection(0, 0.4, 0.3, 0.12, 0.94),
      detection(0.25, 0.41, 0.3, 0.12, 0.58),
    ]);
    expect(tracks).toHaveLength(1);
    expect(tracks[0]!.points).toHaveLength(2);
  });

  it("starts a new identity at a hard scene boundary", () => {
    const tracks = buildFaceTracks([
      { ...detection(0, 0.4, 0.3), sceneId: 0 },
      { ...detection(0.25, 0.4, 0.3), sceneId: 1 },
    ]);
    expect(tracks).toHaveLength(2);
  });

  it("preserves landmark head direction for professional composition", () => {
    const tracks = buildFaceTracks([
      { ...detection(0, 0.4, 0.3), lookDirectionX: 0.7 },
      { ...detection(0.25, 0.4, 0.3), lookDirectionX: 0.6 },
    ]);
    expect(tracks[0]!.points.map((point) => point.lookDirectionX)).toEqual([
      0.7,
      0.6,
    ]);
  });
});
