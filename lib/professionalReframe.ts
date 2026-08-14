import { rectArea, rectCenter } from "@/lib/normalizedRect";
import {
  computeTrackMetrics,
  scoreEmbeddedFacecam,
  scoreSpeakingSubject,
  type FaceSourceClassification,
  type FaceTrack,
  type FaceTrackPoint,
} from "@/lib/verticalLayout";

export const REFRAME_STYLES = [
  "professional",
  "dynamic",
  "stable",
  "close",
  "context",
] as const;

export type ReframeStyle = (typeof REFRAME_STYLES)[number];

export type SourceLayout =
  | "single_talking_head"
  | "irl"
  | "gaming_facecam"
  | "multi_person"
  | "desktop"
  | "already_vertical"
  | "unknown";

export type SceneChange = {
  timestampSeconds: number;
  score: number;
};

export type VideoScene = {
  id: string;
  startSeconds: number;
  endSeconds: number;
  sourceLayout: SourceLayout;
  transitionIn: "start" | "hard_cut";
  confidence: number;
};

export type SubjectRole =
  | "primary_creator"
  | "active_speaker"
  | "embedded_facecam"
  | "supporting_person"
  | "unknown";

export type CropInterpolation = "hold" | "ease_in_out" | "linear" | "cut";

export type CropKeyframeReason =
  | "initial_composition"
  | "subject_motion"
  | "speaker_change"
  | "reaction"
  | "scene_change"
  | "manual_override"
  | "fallback";

export type CropKeyframe = {
  /** Time relative to the selected clip start. */
  timestampSeconds: number;
  centerX: number;
  centerY: number;
  /** Normalized source dimensions represented by the crop. */
  cropWidth: number;
  cropHeight: number;
  interpolation: CropInterpolation;
  reason: CropKeyframeReason;
  subjectTrackId?: string;
  confidence: number;
};

export type CompositionTarget = CropKeyframe & {
  sceneId: string;
  subjectRole: SubjectRole;
};

export type ReframeConfidence = {
  subjectConfidence: number;
  compositionConfidence: number;
  trackingConfidence: number;
  overallConfidence: number;
  warnings: string[];
};

export type VirtualCameraShot = {
  id: string;
  startSeconds: number;
  endSeconds: number;
  subjectTrackIds: string[];
  transitionIn: "start" | "cut" | "pan";
  reason: CropKeyframeReason;
  confidence: ReframeConfidence;
};

export type CameraPlanValidation = {
  valid: boolean;
  repaired: boolean;
  sampledFrames: number;
  maximumVelocity: number;
  maximumAcceleration: number;
  warnings: string[];
};

export type VirtualCameraPlan = {
  clipId: string;
  sourceLayout: SourceLayout;
  style: ReframeStyle;
  scenes: VideoScene[];
  primarySubjectTrackIds: string[];
  shots: VirtualCameraShot[];
  cropKeyframes: CropKeyframe[];
  overallConfidence: number;
  warnings: string[];
  validation: CameraPlanValidation;
  version: string;
};

export type ManualReframeKeyframe = Pick<
  CropKeyframe,
  "timestampSeconds" | "centerX" | "centerY" | "cropWidth" | "cropHeight"
> & {
  interpolation?: CropInterpolation;
};

export interface ProfessionalReframeInput {
  clipId: string;
  clipStartSeconds: number;
  clipEndSeconds: number;
  sourceWidth: number;
  sourceHeight: number;
  classification: FaceSourceClassification;
  tracks: FaceTrack[];
  sampledFrames: number;
  primaryTrackId?: string;
  lockedTrackId?: string;
  sceneChanges?: SceneChange[];
  style?: ReframeStyle;
  manualKeyframes?: ManualReframeKeyframe[];
}

type PlannerProfile = {
  deadZoneRatio: number;
  maxVelocity: number;
  maxAcceleration: number;
  maxJerk: number;
  lookaheadSeconds: number;
  minimumShotSeconds: number;
  switchConfirmationSeconds: number;
  switchScoreMargin: number;
  lossHoldSeconds: number;
  zoom: number;
};

type SelectedSample = {
  timestampSeconds: number;
  sceneId: string;
  point?: FaceTrackPoint;
  trackId?: string;
  role: SubjectRole;
  confidence: number;
  switchReason?: "speaker_change" | "scene_change";
};

const PLAN_VERSION = "professional-reframe-v1";
const SAMPLE_STEP_SECONDS = 0.25;

const STYLE_PROFILES: Record<ReframeStyle, PlannerProfile> = {
  professional: {
    deadZoneRatio: 0.22,
    maxVelocity: 0.24,
    maxAcceleration: 0.5,
    maxJerk: 1.35,
    lookaheadSeconds: 0.75,
    minimumShotSeconds: 1.35,
    switchConfirmationSeconds: 0.55,
    switchScoreMargin: 0.065,
    lossHoldSeconds: 1.4,
    zoom: 1,
  },
  dynamic: {
    deadZoneRatio: 0.14,
    maxVelocity: 0.34,
    maxAcceleration: 0.72,
    maxJerk: 1.8,
    lookaheadSeconds: 0.55,
    minimumShotSeconds: 0.95,
    switchConfirmationSeconds: 0.4,
    switchScoreMargin: 0.05,
    lossHoldSeconds: 1,
    zoom: 1.06,
  },
  stable: {
    deadZoneRatio: 0.32,
    maxVelocity: 0.15,
    maxAcceleration: 0.32,
    maxJerk: 0.9,
    lookaheadSeconds: 1,
    minimumShotSeconds: 2.2,
    switchConfirmationSeconds: 0.75,
    switchScoreMargin: 0.09,
    lossHoldSeconds: 2,
    zoom: 1,
  },
  close: {
    deadZoneRatio: 0.18,
    maxVelocity: 0.22,
    maxAcceleration: 0.46,
    maxJerk: 1.2,
    lookaheadSeconds: 0.8,
    minimumShotSeconds: 1.5,
    switchConfirmationSeconds: 0.6,
    switchScoreMargin: 0.07,
    lossHoldSeconds: 1.4,
    zoom: 1.16,
  },
  context: {
    deadZoneRatio: 0.3,
    maxVelocity: 0.18,
    maxAcceleration: 0.38,
    maxJerk: 1,
    lookaheadSeconds: 0.9,
    minimumShotSeconds: 1.8,
    switchConfirmationSeconds: 0.65,
    switchScoreMargin: 0.08,
    lossHoldSeconds: 1.8,
    zoom: 1,
  },
};

function profileForSource(
  style: ReframeStyle,
  sourceLayout: SourceLayout
): PlannerProfile {
  const base = STYLE_PROFILES[style];
  if (sourceLayout === "multi_person") {
    return {
      ...base,
      deadZoneRatio: Math.max(base.deadZoneRatio, 0.26),
      maxVelocity: base.maxVelocity * 0.82,
      minimumShotSeconds: base.minimumShotSeconds * 1.2,
      switchConfirmationSeconds: base.switchConfirmationSeconds * 1.1,
    };
  }
  if (sourceLayout === "irl") {
    return {
      ...base,
      maxVelocity: base.maxVelocity * 1.12,
      maxAcceleration: base.maxAcceleration * 1.08,
      lookaheadSeconds: Math.min(base.lookaheadSeconds, 0.75),
    };
  }
  if (
    sourceLayout === "gaming_facecam" ||
    sourceLayout === "already_vertical" ||
    sourceLayout === "desktop"
  ) {
    return {
      ...base,
      deadZoneRatio: Math.max(base.deadZoneRatio, 0.42),
      maxVelocity: Math.min(base.maxVelocity, 0.14),
      maxAcceleration: Math.min(base.maxAcceleration, 0.3),
      zoom: 1,
    };
  }
  return base;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function average(values: number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

/** Remove isolated detector jumps without erasing deliberate subject motion. */
export function rejectTrackOutliers(track: FaceTrack): FaceTrack {
  if (track.points.length < 5) return track;
  const points = [...track.points].sort(
    (a, b) => a.timestampSeconds - b.timestampSeconds
  );
  const filtered = points.filter((point, index) => {
    const local = points.slice(Math.max(0, index - 2), index + 3);
    const center = rectCenter(point.rect);
    const medianX = median(local.map((item) => rectCenter(item.rect).x));
    const medianY = median(local.map((item) => rectCenter(item.rect).y));
    const medianArea = Math.max(0.0001, median(local.map((item) => rectArea(item.rect))));
    const areaRatio = rectArea(point.rect) / medianArea;
    const centerDelta = Math.hypot(center.x - medianX, center.y - medianY);
    const spatialLimit = Math.max(0.075, Math.sqrt(medianArea) * 0.85);
    const suspicious =
      centerDelta > spatialLimit || areaRatio < 0.38 || areaRatio > 2.6;
    return !suspicious || point.confidence >= 0.88;
  });
  const safe = filtered.length >= Math.max(3, points.length * 0.55) ? filtered : points;
  return {
    ...track,
    points: safe,
    firstSeenSeconds: safe[0]?.timestampSeconds ?? track.firstSeenSeconds,
    lastSeenSeconds: safe[safe.length - 1]?.timestampSeconds ?? track.lastSeenSeconds,
    averageConfidence: average(safe.map((point) => point.confidence)),
  };
}

export function classifySourceLayout(
  classification: FaceSourceClassification,
  sourceWidth: number,
  sourceHeight: number,
  tracks: FaceTrack[],
  sampledFrames: number
): SourceLayout {
  if (sourceHeight > sourceWidth * 1.2) return "already_vertical";
  if (classification === "embedded_facecam") return "gaming_facecam";
  if (classification === "multiple_faces") return "multi_person";
  if (classification === "no_face") {
    return sourceWidth >= sourceHeight ? "desktop" : "unknown";
  }
  const primary = tracks
    .map((track) => ({ track, metrics: computeTrackMetrics(track, sampledFrames) }))
    .sort((a, b) => b.metrics.persistence - a.metrics.persistence)[0];
  return (primary?.metrics.centerMovement ?? 0) > 0.16
    ? "irl"
    : "single_talking_head";
}

export function buildVideoScenes(
  startSeconds: number,
  endSeconds: number,
  sourceLayout: SourceLayout,
  changes: SceneChange[] = []
): VideoScene[] {
  const boundaries = changes
    .filter(
      (change) =>
        Number.isFinite(change.timestampSeconds) &&
        change.timestampSeconds > startSeconds + 0.35 &&
        change.timestampSeconds < endSeconds - 0.35 &&
        change.score >= 0.24
    )
    .sort((a, b) => a.timestampSeconds - b.timestampSeconds)
    .filter(
      (change, index, all) =>
        index === 0 ||
        change.timestampSeconds - all[index - 1]!.timestampSeconds >= 0.55
    );
  const starts = [startSeconds, ...boundaries.map((item) => item.timestampSeconds)];
  return starts.map((sceneStart, index) => ({
    id: `scene-${index + 1}`,
    startSeconds: sceneStart,
    endSeconds: starts[index + 1] ?? endSeconds,
    sourceLayout,
    transitionIn: index === 0 ? "start" : "hard_cut",
    confidence:
      index === 0 ? 1 : clamp(boundaries[index - 1]?.score ?? 0.5, 0, 1),
  }));
}

function closestPoint(
  track: FaceTrack,
  timestampSeconds: number,
  maxDistanceSeconds = 0.65
): FaceTrackPoint | undefined {
  let closest: FaceTrackPoint | undefined;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const point of track.points) {
    const delta = Math.abs(point.timestampSeconds - timestampSeconds);
    if (delta < closestDistance) {
      closest = point;
      closestDistance = delta;
    }
  }
  return closestDistance <= maxDistanceSeconds ? closest : undefined;
}

function localMouthActivity(
  track: FaceTrack,
  timestampSeconds: number,
  windowSeconds = 0.7
): number {
  const values = track.points
    .filter(
      (point) =>
        Math.abs(point.timestampSeconds - timestampSeconds) <= windowSeconds &&
        Number.isFinite(point.mouthOpenRatio)
    )
    .map((point) => point.mouthOpenRatio as number);
  if (values.length < 3) return 0;
  const mean = average(values);
  const deviation = Math.sqrt(
    average(values.map((value) => (value - mean) ** 2))
  );
  return clamp(deviation * 9 + (Math.max(...values) - Math.min(...values)) * 2.2, 0, 1);
}

function globalTrackScores(
  tracks: FaceTrack[],
  sampledFrames: number,
  sourceLayout: SourceLayout,
  primaryTrackId?: string,
  lockedTrackId?: string
): Map<string, number> {
  return new Map(
    tracks.map((track) => {
      const metrics = computeTrackMetrics(track, sampledFrames);
      const roleScore =
        sourceLayout === "multi_person" || sourceLayout === "single_talking_head"
          ? scoreSpeakingSubject(metrics)
          : scoreEmbeddedFacecam(metrics);
      const score =
        roleScore +
        (track.id === primaryTrackId ? 0.22 : 0) +
        (track.id === lockedTrackId ? 1 : 0);
      return [track.id, score];
    })
  );
}

function sceneAt(scenes: VideoScene[], timestampSeconds: number): VideoScene {
  return (
    scenes.find(
      (scene) =>
        timestampSeconds >= scene.startSeconds &&
        timestampSeconds < scene.endSeconds
    ) ?? scenes[scenes.length - 1]!
  );
}

function selectSubjects(
  tracks: FaceTrack[],
  scenes: VideoScene[],
  input: ProfessionalReframeInput,
  profile: PlannerProfile,
  sourceLayout: SourceLayout
): SelectedSample[] {
  const scores = globalTrackScores(
    tracks,
    input.sampledFrames,
    sourceLayout,
    input.primaryTrackId,
    input.lockedTrackId
  );
  const sortedTracks = [...tracks].sort(
    (a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0)
  );
  let activeId = input.lockedTrackId ?? input.primaryTrackId ?? sortedTracks[0]?.id;
  let activeSince = input.clipStartSeconds;
  let lastVisibleAt = input.clipStartSeconds;
  let challengerId: string | undefined;
  let challengerSince = input.clipStartSeconds;
  let previousSceneId = scenes[0]!.id;
  const samples: SelectedSample[] = [];

  for (
    let time = input.clipStartSeconds;
    time <= input.clipEndSeconds + 1e-6;
    time += SAMPLE_STEP_SECONDS
  ) {
    const scene = sceneAt(scenes, time);
    const sceneChanged = scene.id !== previousSceneId;
    const visible = sortedTracks.flatMap((track) => {
      const point = closestPoint(track, time);
      if (!point) return [];
      const mouth = localMouthActivity(track, time);
      const area = rectArea(point.rect);
      return [
        {
          track,
          point,
          activity: mouth,
          score:
            (scores.get(track.id) ?? 0) * 0.38 +
            mouth * (sourceLayout === "multi_person" ? 0.5 : 0.2) +
            point.confidence * 0.08 +
            Math.min(1, area * 8) * 0.04,
        },
      ];
    });

    if (sceneChanged) {
      const preferred =
        visible.find((item) => item.track.id === input.lockedTrackId) ??
        visible.find((item) => item.track.id === input.primaryTrackId) ??
        visible.sort((a, b) => b.score - a.score)[0];
      activeId = preferred?.track.id ?? activeId;
      activeSince = time;
      challengerId = undefined;
      previousSceneId = scene.id;
    }

    const current = visible.find((item) => item.track.id === activeId);
    if (current) lastVisibleAt = time;

    if (input.lockedTrackId) {
      const locked = visible.find((item) => item.track.id === input.lockedTrackId);
      if (locked) activeId = locked.track.id;
    } else if (visible.length > 0) {
      const best = visible.sort((a, b) => b.score - a.score)[0]!;
      const currentScore = current?.score ?? 0;
      const activeMissing = !current && time - lastVisibleAt > profile.lossHoldSeconds;
      const speakerEvidence =
        sourceLayout !== "multi_person" || best.activity >= 0.035;
      const canChallenge =
        best.track.id !== activeId &&
        speakerEvidence &&
        (activeMissing ||
          (time - activeSince >= profile.minimumShotSeconds &&
            best.score >= currentScore + profile.switchScoreMargin));
      if (canChallenge) {
        if (challengerId !== best.track.id) {
          challengerId = best.track.id;
          challengerSince = time;
        } else if (
          activeMissing ||
          time - challengerSince >= profile.switchConfirmationSeconds
        ) {
          activeId = best.track.id;
          activeSince = time;
          lastVisibleAt = time;
          challengerId = undefined;
        }
      } else {
        challengerId = undefined;
      }
    }

    const selected = visible.find((item) => item.track.id === activeId);
    const previous = samples[samples.length - 1];
    const switched = previous?.trackId && selected?.track.id !== previous.trackId;
    samples.push({
      timestampSeconds: time,
      sceneId: scene.id,
      point: selected?.point,
      trackId: selected?.track.id ?? activeId,
      role:
        sourceLayout === "gaming_facecam"
          ? "embedded_facecam"
          : sourceLayout === "multi_person"
            ? "active_speaker"
            : "primary_creator",
      confidence: selected?.point.confidence ?? 0.25,
      switchReason: sceneChanged
        ? "scene_change"
        : switched
          ? "speaker_change"
          : undefined,
    });
  }
  return samples;
}

function smoothCompositionTargets(
  samples: SelectedSample[],
  input: ProfessionalReframeInput,
  sourceLayout: SourceLayout,
  profile: PlannerProfile
): CompositionTarget[] {
  const baseCropWidth = clamp(
    (9 / 16) * (input.sourceHeight / Math.max(1, input.sourceWidth)),
    0.08,
    1
  );
  const zoom =
    sourceLayout === "already_vertical" || sourceLayout === "gaming_facecam"
      ? 1
      : profile.zoom;
  const cropWidth = clamp(baseCropWidth / zoom, 0.06, 1);
  const cropHeight = clamp(1 / zoom, 0.68, 1);

  return samples.map((sample, sampleIndex) => {
    const neighborhood = samples.filter(
      (candidate) =>
        candidate.sceneId === sample.sceneId &&
        candidate.trackId === sample.trackId &&
        candidate.point &&
        Math.abs(candidate.timestampSeconds - sample.timestampSeconds) <=
          profile.lookaheadSeconds
    );
    const future = neighborhood.filter(
      (candidate) => candidate.timestampSeconds >= sample.timestampSeconds
    );
    const points = neighborhood.map((candidate) => candidate.point!);
    const futurePoints = future.map((candidate) => candidate.point!);
    const currentCenter = sample.point ? rectCenter(sample.point.rect) : { x: 0.5, y: 0.5 };
    const stableX = points.length
      ? median(points.map((point) => rectCenter(point.rect).x))
      : currentCenter.x;
    const futureX = futurePoints.length
      ? median(futurePoints.map((point) => rectCenter(point.rect).x))
      : stableX;
    const predictedX = stableX * 0.78 + futureX * 0.22;
    const eyeY = sample.point
      ? sample.point.rect.y + sample.point.rect.height * 0.38
      : 0.35;
    const centerY = eyeY + cropHeight * 0.15;
    const previousSample = samples[sampleIndex - 1];
    const speakerDistance =
      sample.point && previousSample?.point
        ? Math.hypot(
            rectCenter(sample.point.rect).x -
              rectCenter(previousSample.point.rect).x,
            rectCenter(sample.point.rect).y -
              rectCenter(previousSample.point.rect).y
          )
        : 1;
    const cutForSpeaker =
      sample.switchReason === "speaker_change" &&
      speakerDistance > Math.max(0.13, cropWidth * 0.45);
    const hardTransition =
      sample.switchReason === "scene_change" || cutForSpeaker;
    return {
      timestampSeconds: sample.timestampSeconds - input.clipStartSeconds,
      centerX: clamp(predictedX, cropWidth / 2, 1 - cropWidth / 2),
      centerY: clamp(centerY, cropHeight / 2, 1 - cropHeight / 2),
      cropWidth,
      cropHeight,
      interpolation: hardTransition
        ? "cut"
        : sample.switchReason === "speaker_change"
          ? "ease_in_out"
          : "hold",
      reason:
        sample.switchReason === "scene_change"
          ? "scene_change"
          : sample.switchReason === "speaker_change"
            ? "speaker_change"
            : sample.point
              ? "subject_motion"
              : "fallback",
      subjectTrackId: sample.trackId,
      confidence: sample.confidence,
      sceneId: sample.sceneId,
      subjectRole: sample.role,
    };
  });
}

function applyVirtualCameraDynamics(
  targets: CompositionTarget[],
  profile: PlannerProfile
): CropKeyframe[] {
  if (targets.length === 0) return [];
  let x = targets[0]!.centerX;
  let y = targets[0]!.centerY;
  let velocityX = 0;
  let velocityY = 0;
  let accelerationX = 0;
  let accelerationY = 0;
  const dense: CropKeyframe[] = [];

  for (let index = 0; index < targets.length; index++) {
    const target = targets[index]!;
    const previous = targets[index - 1];
    const dt = Math.max(
      0.05,
      previous ? target.timestampSeconds - previous.timestampSeconds : SAMPLE_STEP_SECONDS
    );
    const hardTransition =
      index === 0 || target.interpolation === "cut" || target.sceneId !== previous?.sceneId;

    if (hardTransition) {
      x = target.centerX;
      y = target.centerY;
      velocityX = 0;
      velocityY = 0;
      accelerationX = 0;
      accelerationY = 0;
    } else {
      const deadX = target.cropWidth * profile.deadZoneRatio * 0.5;
      const deadY = target.cropHeight * profile.deadZoneRatio * 0.35;
      const errorX = target.centerX - x;
      const errorY = target.centerY - y;
      const desiredX = Math.abs(errorX) <= deadX ? x : target.centerX;
      const desiredY = Math.abs(errorY) <= deadY ? y : target.centerY;
      const requestedAccelerationX = (desiredX - x) * 3.4 - velocityX * 2.5;
      const requestedAccelerationY = (desiredY - y) * 3.4 - velocityY * 2.5;
      const maxAccelerationDelta = profile.maxJerk * dt;
      accelerationX = clamp(
        requestedAccelerationX,
        accelerationX - maxAccelerationDelta,
        accelerationX + maxAccelerationDelta
      );
      accelerationY = clamp(
        requestedAccelerationY,
        accelerationY - maxAccelerationDelta,
        accelerationY + maxAccelerationDelta
      );
      accelerationX = clamp(
        accelerationX,
        -profile.maxAcceleration,
        profile.maxAcceleration
      );
      accelerationY = clamp(
        accelerationY,
        -profile.maxAcceleration,
        profile.maxAcceleration
      );
      velocityX = clamp(
        velocityX + accelerationX * dt,
        -profile.maxVelocity,
        profile.maxVelocity
      );
      velocityY = clamp(
        velocityY + accelerationY * dt,
        -profile.maxVelocity * 0.6,
        profile.maxVelocity * 0.6
      );
      x += velocityX * dt;
      y += velocityY * dt;
    }

    x = clamp(x, target.cropWidth / 2, 1 - target.cropWidth / 2);
    y = clamp(y, target.cropHeight / 2, 1 - target.cropHeight / 2);
    const moved =
      !previous ||
      Math.abs(x - (dense[dense.length - 1]?.centerX ?? x)) > 0.0015 ||
      Math.abs(y - (dense[dense.length - 1]?.centerY ?? y)) > 0.0015;
    dense.push({
      ...target,
      centerX: x,
      centerY: y,
      interpolation: hardTransition
        ? index === 0
          ? "hold"
          : "cut"
        : moved
          ? "ease_in_out"
          : "hold",
      reason:
        index === 0
          ? "initial_composition"
          : hardTransition
            ? target.reason
            : target.reason === "speaker_change"
              ? "speaker_change"
            : moved
              ? "subject_motion"
              : target.reason,
    });
  }

  const sparse: CropKeyframe[] = [dense[0]!];
  for (let index = 1; index < dense.length; index++) {
    const frame = dense[index]!;
    const previous = sparse[sparse.length - 1]!;
    const cut = frame.interpolation === "cut";
    const moved =
      Math.abs(frame.centerX - previous.centerX) >= 0.008 ||
      Math.abs(frame.centerY - previous.centerY) >= 0.006;
    const spaced = frame.timestampSeconds - previous.timestampSeconds >= 0.5;
    if (cut || (moved && spaced)) sparse.push(frame);
  }
  const final = dense[dense.length - 1]!;
  if (final.timestampSeconds - sparse[sparse.length - 1]!.timestampSeconds > 0.4) {
    sparse.push(final);
  }
  return capKeyframes(sparse, 120);
}

function capKeyframes(keyframes: CropKeyframe[], maximum: number): CropKeyframe[] {
  if (keyframes.length <= maximum) return keyframes;
  const mandatory = new Set(
    keyframes
      .map((keyframe, index) => ({ keyframe, index }))
      .filter(
        ({ keyframe, index }) =>
          index === 0 ||
          index === keyframes.length - 1 ||
          keyframe.interpolation === "cut" ||
          keyframe.reason === "manual_override"
      )
      .map(({ index }) => index)
  );
  const remaining = Math.max(1, maximum - mandatory.size);
  const optionalCount = keyframes.length - mandatory.size;
  const stride = Math.max(1, Math.ceil(optionalCount / remaining));
  let optionalIndex = 0;
  return keyframes.filter((_, index) => {
    if (mandatory.has(index)) return true;
    const keep = optionalIndex % stride === 0;
    optionalIndex += 1;
    return keep;
  });
}

function normalizeManualKeyframes(
  manualKeyframes: ManualReframeKeyframe[],
  duration: number
): CropKeyframe[] {
  return manualKeyframes
    .filter(
      (keyframe) =>
        Number.isFinite(keyframe.timestampSeconds) &&
        keyframe.timestampSeconds >= 0 &&
        keyframe.timestampSeconds <= duration
    )
    .map((keyframe) => ({
      timestampSeconds: keyframe.timestampSeconds,
      centerX: clamp(keyframe.centerX, 0, 1),
      centerY: clamp(keyframe.centerY, 0, 1),
      cropWidth: clamp(keyframe.cropWidth, 0.05, 1),
      cropHeight: clamp(keyframe.cropHeight, 0.05, 1),
      interpolation: keyframe.interpolation ?? "ease_in_out",
      reason: "manual_override" as const,
      confidence: 1,
    }))
    .sort((a, b) => a.timestampSeconds - b.timestampSeconds);
}

function mergeManualKeyframes(
  automatic: CropKeyframe[],
  manual: CropKeyframe[]
): CropKeyframe[] {
  if (manual.length === 0) return automatic;
  const merged = automatic.filter(
    (auto) =>
      !manual.some(
        (override) => Math.abs(override.timestampSeconds - auto.timestampSeconds) < 0.2
      )
  );
  return [...merged, ...manual].sort(
    (a, b) => a.timestampSeconds - b.timestampSeconds
  );
}

export function validateAndRepairCameraPlan(
  keyframes: CropKeyframe[],
  profile: PlannerProfile = STYLE_PROFILES.professional
): { keyframes: CropKeyframe[]; validation: CameraPlanValidation } {
  const warnings: string[] = [];
  let repaired = false;
  let maximumVelocity = 0;
  let maximumAcceleration = 0;
  let previousVelocity = 0;
  const repairedFrames: CropKeyframe[] = [];

  for (const original of [...keyframes].sort(
    (a, b) => a.timestampSeconds - b.timestampSeconds
  )) {
    const frame = { ...original };
    const minX = frame.cropWidth / 2;
    const minY = frame.cropHeight / 2;
    const boundedX = clamp(frame.centerX, minX, 1 - minX);
    const boundedY = clamp(frame.centerY, minY, 1 - minY);
    if (boundedX !== frame.centerX || boundedY !== frame.centerY) {
      frame.centerX = boundedX;
      frame.centerY = boundedY;
      repaired = true;
      warnings.push("A crop position was repaired to stay inside the source frame.");
    }

    const previous = repairedFrames[repairedFrames.length - 1];
    if (previous && frame.interpolation !== "cut") {
      const dt = Math.max(0.001, frame.timestampSeconds - previous.timestampSeconds);
      const dx = frame.centerX - previous.centerX;
      const velocity = Math.abs(dx) / dt;
      maximumVelocity = Math.max(maximumVelocity, velocity);
      if (velocity > profile.maxVelocity * 1.08) {
        frame.centerX =
          previous.centerX + Math.sign(dx) * profile.maxVelocity * 1.08 * dt;
        repaired = true;
        warnings.push("An overly fast camera move was slowed before rendering.");
      }
      const repairedVelocity = Math.abs(frame.centerX - previous.centerX) / dt;
      const acceleration = Math.abs(repairedVelocity - previousVelocity) / dt;
      maximumAcceleration = Math.max(maximumAcceleration, acceleration);
      previousVelocity = repairedVelocity;
    } else {
      previousVelocity = 0;
    }
    repairedFrames.push(frame);
  }

  return {
    keyframes: repairedFrames,
    validation: {
      valid: true,
      repaired,
      sampledFrames: Math.max(1, Math.round((keyframes.at(-1)?.timestampSeconds ?? 0) * 10)),
      maximumVelocity,
      maximumAcceleration,
      warnings: [...new Set(warnings)],
    },
  };
}

function confidenceForShot(
  frames: CropKeyframe[],
  warnings: string[]
): ReframeConfidence {
  const tracking = clamp(average(frames.map((frame) => frame.confidence)), 0, 1);
  const subject = frames.some((frame) => frame.subjectTrackId) ? tracking : 0.35;
  const composition = frames.length > 0 ? 0.92 : 0.3;
  return {
    subjectConfidence: subject,
    compositionConfidence: composition,
    trackingConfidence: tracking,
    overallConfidence: clamp(subject * 0.45 + tracking * 0.35 + composition * 0.2, 0, 1),
    warnings,
  };
}

function buildShots(
  keyframes: CropKeyframe[],
  duration: number,
  warnings: string[]
): VirtualCameraShot[] {
  if (keyframes.length === 0) return [];
  const shotStarts = keyframes.filter(
    (frame, index) =>
      index === 0 ||
      frame.interpolation === "cut" ||
      frame.reason === "speaker_change"
  );
  return shotStarts.map((start, index) => {
    const end = shotStarts[index + 1]?.timestampSeconds ?? duration;
    const frames = keyframes.filter(
      (frame) => frame.timestampSeconds >= start.timestampSeconds && frame.timestampSeconds <= end
    );
    return {
      id: `shot-${index + 1}`,
      startSeconds: start.timestampSeconds,
      endSeconds: end,
      subjectTrackIds: [...new Set(frames.flatMap((frame) => frame.subjectTrackId ?? []))],
      transitionIn:
        index === 0 ? "start" : start.interpolation === "cut" ? "cut" : "pan",
      reason: start.reason,
      confidence: confidenceForShot(frames, warnings),
    };
  });
}

export function generateProfessionalReframePlan(
  input: ProfessionalReframeInput
): VirtualCameraPlan {
  const style = input.style ?? "professional";
  const duration = Math.max(0.1, input.clipEndSeconds - input.clipStartSeconds);
  const tracks = input.tracks.map(rejectTrackOutliers);
  const sourceLayout = classifySourceLayout(
    input.classification,
    input.sourceWidth,
    input.sourceHeight,
    tracks,
    input.sampledFrames
  );
  const profile = profileForSource(style, sourceLayout);
  const scenes = buildVideoScenes(
    input.clipStartSeconds,
    input.clipEndSeconds,
    sourceLayout,
    input.sceneChanges
  );
  const warnings: string[] = [];
  if (tracks.length === 0) {
    warnings.push("No reliable face track was available; conservative center framing was used.");
  }
  if (input.lockedTrackId && !tracks.some((track) => track.id === input.lockedTrackId)) {
    warnings.push("The locked subject was unavailable, so the strongest persistent subject was used.");
  }

  const selected = selectSubjects(tracks, scenes, input, profile, sourceLayout);
  const targets = smoothCompositionTargets(selected, input, sourceLayout, profile);
  const automatic = applyVirtualCameraDynamics(targets, profile);
  const manual = normalizeManualKeyframes(input.manualKeyframes ?? [], duration);
  const merged = mergeManualKeyframes(automatic, manual);
  const { keyframes, validation } = validateAndRepairCameraPlan(merged, profile);
  warnings.push(...validation.warnings);
  const shots = buildShots(keyframes, duration, warnings);
  const overallConfidence = shots.length
    ? average(shots.map((shot) => shot.confidence.overallConfidence))
    : 0.25;

  return {
    clipId: input.clipId,
    sourceLayout,
    style,
    scenes,
    primarySubjectTrackIds: [
      ...new Set(keyframes.flatMap((frame) => frame.subjectTrackId ?? [])),
    ],
    shots,
    cropKeyframes: keyframes,
    overallConfidence,
    warnings: [...new Set(warnings)],
    validation,
    version: PLAN_VERSION,
  };
}
