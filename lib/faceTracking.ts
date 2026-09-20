/**
 * Groups per-frame face detections into face tracks over time.
 *
 * Pure functions only — no I/O — so the matching rules are unit-testable and
 * usable from both the analysis service and tests.
 */

import {
  normalizeRect,
  rectCenterDistance,
  rectIoU,
  type NormalizedRect,
} from "@/lib/normalizedRect";
import type {
  FaceDetection,
  FaceTrack,
  FaceTrackPoint,
} from "@/lib/verticalLayout";
import { FACE_ANALYSIS_CONFIG } from "@/lib/verticalLayout";

export interface TrackMatchingConfig {
  /** Max normalized center distance for a detection to join a track. */
  centerMatchDistance: number;
  /** Min width/height ratio (detection vs track) to still be the same face. */
  sizeRatioMin: number;
  /** Max width/height ratio (detection vs track) to still be the same face. */
  sizeRatioMax: number;
  /** A track may disappear for this many seconds before it stops matching. */
  trackGapSeconds: number;
  /** Detections below this confidence are dropped before tracking. */
  minConfidence: number;
}

export const DEFAULT_TRACK_MATCHING: TrackMatchingConfig = {
  centerMatchDistance: FACE_ANALYSIS_CONFIG.centerMatchDistance,
  sizeRatioMin: FACE_ANALYSIS_CONFIG.sizeRatioMin,
  sizeRatioMax: FACE_ANALYSIS_CONFIG.sizeRatioMax,
  trackGapSeconds: FACE_ANALYSIS_CONFIG.trackGapSeconds,
  minConfidence: FACE_ANALYSIS_CONFIG.minConfidence,
};

interface MutableTrack {
  id: string;
  points: FaceTrackPoint[];
  lastRect: NormalizedRect;
  lastSeenSeconds: number;
  confidenceSum: number;
  velocityX: number;
  velocityY: number;
}

function sizeRatioOk(
  a: NormalizedRect,
  b: NormalizedRect,
  config: TrackMatchingConfig
): boolean {
  const widthRatio = a.width / b.width;
  const heightRatio = a.height / b.height;
  return (
    widthRatio >= config.sizeRatioMin &&
    widthRatio <= config.sizeRatioMax &&
    heightRatio >= config.sizeRatioMin &&
    heightRatio <= config.sizeRatioMax
  );
}

/**
 * Score how well a detection continues a track. Higher is better; null means
 * "not a plausible match". Prefers highest overlap, then smallest distance.
 */
function matchScore(
  rect: NormalizedRect,
  track: MutableTrack,
  timestampSeconds: number,
  config: TrackMatchingConfig
): number | null {
  if (timestampSeconds - track.lastSeenSeconds > config.trackGapSeconds) {
    return null;
  }
  if (!sizeRatioOk(rect, track.lastRect, config)) return null;

  const elapsed = Math.max(0.001, timestampSeconds - track.lastSeenSeconds);
  const lastCenter = {
    x: track.lastRect.x + track.lastRect.width / 2,
    y: track.lastRect.y + track.lastRect.height / 2,
  };
  const predictedRect = {
    ...track.lastRect,
    x: track.lastRect.x + track.velocityX * elapsed,
    y: track.lastRect.y + track.velocityY * elapsed,
  };
  const predictedDistance = rectCenterDistance(rect, predictedRect);
  const lastDistance = rectCenterDistance(rect, track.lastRect);
  const allowedDistance =
    config.centerMatchDistance * Math.min(1.75, 1 + elapsed * 0.35);
  if (Math.min(predictedDistance, lastDistance) > allowedDistance) return null;

  const iou = rectIoU(rect, track.lastRect);
  const predictedAffinity =
    1 - Math.min(1, predictedDistance / Math.max(0.001, allowedDistance));
  const previousAffinity =
    1 - Math.min(1, lastDistance / Math.max(0.001, allowedDistance));
  const rectCenter = {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  };
  const displacementX = (rectCenter.x - lastCenter.x) / elapsed;
  const displacementY = (rectCenter.y - lastCenter.y) / elapsed;
  const directionPenalty = Math.min(
    0.65,
    Math.hypot(
      displacementX - track.velocityX,
      displacementY - track.velocityY
    ) * 0.75
  );
  return (
    iou * 1.45 +
    predictedAffinity * 1.15 +
    previousAffinity * 0.45 -
    directionPenalty
  );
}

/**
 * Build face tracks from raw detections. Detections are processed in timestamp
 * order; each detection joins at most one track, and each track accepts at
 * most one detection per sampled frame.
 */
export function buildFaceTracks(
  detections: FaceDetection[],
  config: TrackMatchingConfig = DEFAULT_TRACK_MATCHING
): FaceTrack[] {
  const valid = detections
    .filter((d) => d.confidence >= config.minConfidence)
    .map((d) => {
      const rect = normalizeRect(d.rect);
      return rect ? { ...d, rect } : null;
    })
    .filter((d): d is FaceDetection => d !== null)
    .sort((a, b) => a.timestampSeconds - b.timestampSeconds);

  const tracks: MutableTrack[] = [];
  let nextTrackId = 1;

  // Group detections by sampled frame so one track can't absorb two faces
  // that were visible at the same instant.
  const frames = new Map<number, FaceDetection[]>();
  for (const detection of valid) {
    const key = Math.round(detection.timestampSeconds * 1000);
    const list = frames.get(key);
    if (list) list.push(detection);
    else frames.set(key, [detection]);
  }

  const frameKeys = [...frames.keys()].sort((a, b) => a - b);
  for (const key of frameKeys) {
    const frameDetections = frames.get(key)!;
    const claimedTracks = new Set<string>();

    // Greedy best-match assignment: strongest (detection, track) pairs first.
    const pairs: Array<{
      detection: FaceDetection;
      track: MutableTrack;
      score: number;
    }> = [];
    for (const detection of frameDetections) {
      for (const track of tracks) {
        const score = matchScore(
          detection.rect,
          track,
          detection.timestampSeconds,
          config
        );
        if (score !== null) pairs.push({ detection, track, score });
      }
    }
    pairs.sort((a, b) => b.score - a.score);

    const assigned = new Set<FaceDetection>();
    for (const pair of pairs) {
      if (assigned.has(pair.detection) || claimedTracks.has(pair.track.id)) {
        continue;
      }
      assigned.add(pair.detection);
      claimedTracks.add(pair.track.id);
      const previousCenter = {
        x: pair.track.lastRect.x + pair.track.lastRect.width / 2,
        y: pair.track.lastRect.y + pair.track.lastRect.height / 2,
      };
      const nextCenter = {
        x: pair.detection.rect.x + pair.detection.rect.width / 2,
        y: pair.detection.rect.y + pair.detection.rect.height / 2,
      };
      const elapsed = Math.max(
        0.001,
        pair.detection.timestampSeconds - pair.track.lastSeenSeconds
      );
      const measuredVelocityX = (nextCenter.x - previousCenter.x) / elapsed;
      const measuredVelocityY = (nextCenter.y - previousCenter.y) / elapsed;
      pair.track.velocityX =
        pair.track.velocityX * 0.55 + measuredVelocityX * 0.45;
      pair.track.velocityY =
        pair.track.velocityY * 0.55 + measuredVelocityY * 0.45;
      pair.track.points.push({
        timestampSeconds: pair.detection.timestampSeconds,
        rect: pair.detection.rect,
        confidence: pair.detection.confidence,
        mouthOpenRatio: pair.detection.mouthOpenRatio,
        speakingActivity: pair.detection.speakingActivity,
        audioActivity: pair.detection.audioActivity,
      });
      pair.track.lastRect = pair.detection.rect;
      pair.track.lastSeenSeconds = pair.detection.timestampSeconds;
      pair.track.confidenceSum += pair.detection.confidence;
    }

    for (const detection of frameDetections) {
      if (assigned.has(detection)) continue;
      tracks.push({
        id: `track-${nextTrackId++}`,
        points: [
          {
            timestampSeconds: detection.timestampSeconds,
            rect: detection.rect,
            confidence: detection.confidence,
            mouthOpenRatio: detection.mouthOpenRatio,
            speakingActivity: detection.speakingActivity,
            audioActivity: detection.audioActivity,
          },
        ],
        lastRect: detection.rect,
        lastSeenSeconds: detection.timestampSeconds,
        confidenceSum: detection.confidence,
        velocityX: 0,
        velocityY: 0,
      });
    }
  }

  return tracks.map((track) => ({
    id: track.id,
    points: track.points,
    firstSeenSeconds: track.points[0]!.timestampSeconds,
    lastSeenSeconds: track.lastSeenSeconds,
    averageConfidence: track.confidenceSum / track.points.length,
  }));
}
