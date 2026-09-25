/**
 * Groups per-frame face detections into stable, anonymous face tracks.
 *
 * The association strategy borrows the useful parts of BoT-SORT/ByteTrack
 * without introducing a heavyweight or commercially restrictive dependency:
 * constant-velocity prediction, clip-local appearance cues, two confidence
 * stages, and a globally optimal assignment for every sampled frame.
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
  centerMatchDistance: number;
  sizeRatioMin: number;
  sizeRatioMax: number;
  trackGapSeconds: number;
  minConfidence: number;
  highConfidence: number;
  newTrackConfidence: number;
  appearanceWeight: number;
}

export const DEFAULT_TRACK_MATCHING: TrackMatchingConfig = {
  centerMatchDistance: FACE_ANALYSIS_CONFIG.centerMatchDistance,
  sizeRatioMin: FACE_ANALYSIS_CONFIG.sizeRatioMin,
  sizeRatioMax: FACE_ANALYSIS_CONFIG.sizeRatioMax,
  trackGapSeconds: FACE_ANALYSIS_CONFIG.trackGapSeconds,
  minConfidence: FACE_ANALYSIS_CONFIG.minConfidence,
  highConfidence: 0.72,
  newTrackConfidence: 0.62,
  appearanceWeight: 1.05,
};

interface MutableTrack {
  id: string;
  points: FaceTrackPoint[];
  lastRect: NormalizedRect;
  lastSeenSeconds: number;
  confidenceSum: number;
  velocityX: number;
  velocityY: number;
  velocityWidth: number;
  velocityHeight: number;
  appearanceDescriptor?: number[];
  sceneId?: number;
}

interface TrackAssignment {
  track: MutableTrack;
  detection: FaceDetection;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function sizeRatioOk(
  a: NormalizedRect,
  b: NormalizedRect,
  config: TrackMatchingConfig,
  relaxed: boolean
): boolean {
  const relaxation = relaxed ? 0.78 : 1;
  const lower = config.sizeRatioMin * relaxation;
  const upper = config.sizeRatioMax / relaxation;
  const widthRatio = a.width / b.width;
  const heightRatio = a.height / b.height;
  return (
    widthRatio >= lower &&
    widthRatio <= upper &&
    heightRatio >= lower &&
    heightRatio <= upper
  );
}

function normalizedDescriptor(value: number[] | undefined): number[] | undefined {
  if (!value || value.length < 8) return undefined;
  const clean = value
    .slice(0, 64)
    .map((entry) => (Number.isFinite(entry) ? entry : 0));
  const norm = Math.hypot(...clean);
  if (norm < 1e-6) return undefined;
  return clean.map((entry) => entry / norm);
}

function appearanceAffinity(
  a: number[] | undefined,
  b: number[] | undefined
): number | undefined {
  if (!a || !b || a.length !== b.length) return undefined;
  let dot = 0;
  for (let index = 0; index < a.length; index++) {
    dot += a[index]! * b[index]!;
  }
  return clamp((dot - 0.25) / 0.75, 0, 1);
}

function predictedRect(track: MutableTrack, elapsed: number): NormalizedRect {
  const horizon = Math.min(0.8, elapsed);
  return {
    x: track.lastRect.x + track.velocityX * horizon,
    y: track.lastRect.y + track.velocityY * horizon,
    width: Math.max(0.005, track.lastRect.width + track.velocityWidth * horizon),
    height: Math.max(
      0.005,
      track.lastRect.height + track.velocityHeight * horizon
    ),
  };
}

function matchScore(
  detection: FaceDetection,
  track: MutableTrack,
  config: TrackMatchingConfig,
  relaxed: boolean
): number | null {
  const elapsed = detection.timestampSeconds - track.lastSeenSeconds;
  if (elapsed < -1e-6 || elapsed > config.trackGapSeconds) return null;
  if (
    detection.sceneId !== undefined &&
    track.sceneId !== undefined &&
    detection.sceneId !== track.sceneId
  ) {
    return null;
  }
  if (!sizeRatioOk(detection.rect, track.lastRect, config, relaxed)) return null;

  const predicted = predictedRect(track, Math.max(0.001, elapsed));
  const predictedDistance = rectCenterDistance(detection.rect, predicted);
  const lastDistance = rectCenterDistance(detection.rect, track.lastRect);
  const faceScale = Math.max(
    detection.rect.width,
    detection.rect.height,
    track.lastRect.width,
    track.lastRect.height
  );
  const allowedDistance =
    Math.max(config.centerMatchDistance, faceScale * 0.85) *
    Math.min(relaxed ? 2.3 : 1.8, 1 + Math.max(0, elapsed) * 0.45) *
    (relaxed ? 1.2 : 1);
  const appearance = appearanceAffinity(
    detection.appearanceDescriptor,
    track.appearanceDescriptor
  );
  const bestDistance = Math.min(predictedDistance, lastDistance);
  const appearanceReacquire =
    appearance !== undefined &&
    appearance >= 0.74 &&
    bestDistance <= allowedDistance * 1.65;
  if (bestDistance > allowedDistance && !appearanceReacquire) return null;
  if (appearance !== undefined && appearance < 0.08 && elapsed >= 0.2) return null;

  const predictedAffinity =
    1 - Math.min(1, predictedDistance / Math.max(0.001, allowedDistance));
  const previousAffinity =
    1 - Math.min(1, lastDistance / Math.max(0.001, allowedDistance));
  const widthRatio = detection.rect.width / track.lastRect.width;
  const heightRatio = detection.rect.height / track.lastRect.height;
  const scalePenalty = Math.min(
    0.8,
    (Math.abs(Math.log(widthRatio)) + Math.abs(Math.log(heightRatio))) * 0.38
  );
  const lastCenterX = track.lastRect.x + track.lastRect.width / 2;
  const lastCenterY = track.lastRect.y + track.lastRect.height / 2;
  const nextCenterX = detection.rect.x + detection.rect.width / 2;
  const nextCenterY = detection.rect.y + detection.rect.height / 2;
  const measuredVelocityX = (nextCenterX - lastCenterX) / Math.max(0.001, elapsed);
  const measuredVelocityY = (nextCenterY - lastCenterY) / Math.max(0.001, elapsed);
  const directionPenalty =
    track.points.length >= 2 && elapsed <= 1
      ? Math.min(
          0.7,
          Math.hypot(
            measuredVelocityX - track.velocityX,
            measuredVelocityY - track.velocityY
          ) * 0.55
        )
      : 0;
  const appearancePenalty =
    appearance !== undefined && appearance < 0.3
      ? (0.3 - appearance) * 1.35
      : 0;
  const establishedTrackBonus = Math.min(0.16, track.points.length * 0.018);

  return (
    rectIoU(detection.rect, predicted) * 1.45 +
    rectIoU(detection.rect, track.lastRect) * 0.35 +
    predictedAffinity * 1.2 +
    previousAffinity * 0.38 +
    (appearance ?? 0) * config.appearanceWeight +
    detection.confidence * 0.14 +
    establishedTrackBonus -
    scalePenalty -
    directionPenalty -
    appearancePenalty
  );
}

/** Globally optimal per-frame assignment with explicit unmatched slots. */
function globalAssignments(
  tracks: MutableTrack[],
  detections: FaceDetection[],
  config: TrackMatchingConfig,
  relaxed: boolean
): TrackAssignment[] {
  if (tracks.length === 0 || detections.length === 0) return [];
  const rowCount = tracks.length;
  const columnCount = detections.length;
  const size = rowCount + columnCount;
  const invalidCost = 1_000_000;
  const scores = tracks.map((track) =>
    detections.map((detection) =>
      matchScore(detection, track, config, relaxed)
    )
  );
  const costs = Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, column) => {
      if (row >= rowCount || column >= columnCount) return 0;
      const score = scores[row]![column];
      return score === null || score <= 0 ? invalidCost : -score;
    })
  );

  // Hungarian minimum-cost assignment. Negative real-pair costs compete with
  // zero-cost dummy assignments, so implausible pairs remain unmatched.
  const u = new Array<number>(size + 1).fill(0);
  const v = new Array<number>(size + 1).fill(0);
  const rowForColumn = new Array<number>(size + 1).fill(0);
  const previousColumn = new Array<number>(size + 1).fill(0);
  for (let row = 1; row <= size; row++) {
    rowForColumn[0] = row;
    let column0 = 0;
    const minValue = new Array<number>(size + 1).fill(Number.POSITIVE_INFINITY);
    const used = new Array<boolean>(size + 1).fill(false);
    do {
      used[column0] = true;
      const row0 = rowForColumn[column0]!;
      let delta = Number.POSITIVE_INFINITY;
      let column1 = 0;
      for (let column = 1; column <= size; column++) {
        if (used[column]) continue;
        const current = costs[row0 - 1]![column - 1]! - u[row0]! - v[column]!;
        if (current < minValue[column]!) {
          minValue[column] = current;
          previousColumn[column] = column0;
        }
        if (minValue[column]! < delta) {
          delta = minValue[column]!;
          column1 = column;
        }
      }
      for (let column = 0; column <= size; column++) {
        if (used[column]) {
          u[rowForColumn[column]!] += delta;
          v[column] -= delta;
        } else {
          minValue[column] -= delta;
        }
      }
      column0 = column1;
    } while (rowForColumn[column0] !== 0);
    do {
      const column1 = previousColumn[column0]!;
      rowForColumn[column0] = rowForColumn[column1]!;
      column0 = column1;
    } while (column0 !== 0);
  }

  const assignments: TrackAssignment[] = [];
  for (let column = 1; column <= columnCount; column++) {
    const row = rowForColumn[column]! - 1;
    if (row < 0 || row >= rowCount) continue;
    const score = scores[row]![column - 1];
    if (score === null || score <= 0) continue;
    assignments.push({
      track: tracks[row]!,
      detection: detections[column - 1]!,
    });
  }
  return assignments;
}

function trackPoint(detection: FaceDetection): FaceTrackPoint {
  return {
    timestampSeconds: detection.timestampSeconds,
    rect: detection.rect,
    confidence: detection.confidence,
    lookDirectionX: detection.lookDirectionX,
    mouthOpenRatio: detection.mouthOpenRatio,
    speakingActivity: detection.speakingActivity,
    audioActivity: detection.audioActivity,
  };
}

function applyDetection(track: MutableTrack, detection: FaceDetection): void {
  const elapsed = Math.max(0.001, detection.timestampSeconds - track.lastSeenSeconds);
  const previousCenterX = track.lastRect.x + track.lastRect.width / 2;
  const previousCenterY = track.lastRect.y + track.lastRect.height / 2;
  const nextCenterX = detection.rect.x + detection.rect.width / 2;
  const nextCenterY = detection.rect.y + detection.rect.height / 2;
  const measuredVelocityX = clamp((nextCenterX - previousCenterX) / elapsed, -2, 2);
  const measuredVelocityY = clamp((nextCenterY - previousCenterY) / elapsed, -2, 2);
  const measuredVelocityWidth = clamp(
    (detection.rect.width - track.lastRect.width) / elapsed,
    -1,
    1
  );
  const measuredVelocityHeight = clamp(
    (detection.rect.height - track.lastRect.height) / elapsed,
    -1,
    1
  );
  const measurementWeight = elapsed > 0.8 ? 0.25 : 0.42;
  track.velocityX =
    track.velocityX * (1 - measurementWeight) + measuredVelocityX * measurementWeight;
  track.velocityY =
    track.velocityY * (1 - measurementWeight) + measuredVelocityY * measurementWeight;
  track.velocityWidth =
    track.velocityWidth * (1 - measurementWeight) +
    measuredVelocityWidth * measurementWeight;
  track.velocityHeight =
    track.velocityHeight * (1 - measurementWeight) +
    measuredVelocityHeight * measurementWeight;

  const nextAppearance = normalizedDescriptor(detection.appearanceDescriptor);
  if (nextAppearance) {
    if (
      track.appearanceDescriptor &&
      track.appearanceDescriptor.length === nextAppearance.length
    ) {
      const weight = detection.confidence >= 0.8 ? 0.22 : 0.12;
      track.appearanceDescriptor = normalizedDescriptor(
        track.appearanceDescriptor.map(
          (value, index) => value * (1 - weight) + nextAppearance[index]! * weight
        )
      );
    } else {
      track.appearanceDescriptor = nextAppearance;
    }
  }
  track.points.push(trackPoint(detection));
  track.lastRect = detection.rect;
  track.lastSeenSeconds = detection.timestampSeconds;
  track.confidenceSum += detection.confidence;
  track.sceneId = detection.sceneId;
}

function createTrack(id: string, detection: FaceDetection): MutableTrack {
  return {
    id,
    points: [trackPoint(detection)],
    lastRect: detection.rect,
    lastSeenSeconds: detection.timestampSeconds,
    confidenceSum: detection.confidence,
    velocityX: 0,
    velocityY: 0,
    velocityWidth: 0,
    velocityHeight: 0,
    appearanceDescriptor: normalizedDescriptor(detection.appearanceDescriptor),
    sceneId: detection.sceneId,
  };
}

export function buildFaceTracks(
  detections: FaceDetection[],
  config: TrackMatchingConfig = DEFAULT_TRACK_MATCHING
): FaceTrack[] {
  const valid = detections
    .filter((detection) => detection.confidence >= config.minConfidence)
    .map((detection) => {
      const rect = normalizeRect(detection.rect);
      return rect ? { ...detection, rect } : null;
    })
    .filter((detection): detection is FaceDetection => detection !== null)
    .sort((a, b) => a.timestampSeconds - b.timestampSeconds);

  const tracks: MutableTrack[] = [];
  let nextTrackId = 1;
  const frames = new Map<number, FaceDetection[]>();
  for (const detection of valid) {
    const key = Math.round(detection.timestampSeconds * 1000);
    const list = frames.get(key);
    if (list) list.push(detection);
    else frames.set(key, [detection]);
  }

  for (const key of [...frames.keys()].sort((a, b) => a - b)) {
    const frameDetections = frames.get(key)!;
    const timestampSeconds = frameDetections[0]!.timestampSeconds;
    const sceneId = frameDetections[0]!.sceneId;
    const activeTracks = tracks.filter(
      (track) =>
        timestampSeconds - track.lastSeenSeconds <= config.trackGapSeconds &&
        (sceneId === undefined ||
          track.sceneId === undefined ||
          sceneId === track.sceneId)
    );
    const claimedTracks = new Set<string>();
    const assignedDetections = new Set<FaceDetection>();

    const strongDetections = frameDetections.filter(
      (detection) => detection.confidence >= config.highConfidence
    );
    for (const assignment of globalAssignments(
      activeTracks,
      strongDetections,
      config,
      false
    )) {
      applyDetection(assignment.track, assignment.detection);
      claimedTracks.add(assignment.track.id);
      assignedDetections.add(assignment.detection);
    }

    const remainingTracks = activeTracks.filter(
      (track) => !claimedTracks.has(track.id)
    );
    const remainingDetections = frameDetections.filter(
      (detection) => !assignedDetections.has(detection)
    );
    for (const assignment of globalAssignments(
      remainingTracks,
      remainingDetections,
      config,
      true
    )) {
      applyDetection(assignment.track, assignment.detection);
      claimedTracks.add(assignment.track.id);
      assignedDetections.add(assignment.detection);
    }

    for (const detection of frameDetections) {
      if (
        assignedDetections.has(detection) ||
        detection.confidence < config.newTrackConfidence
      ) {
        continue;
      }
      tracks.push(createTrack(`track-${nextTrackId++}`, detection));
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
