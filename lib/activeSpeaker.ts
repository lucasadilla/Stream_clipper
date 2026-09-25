import type { FaceTrack, FaceTrackPoint } from "@/lib/verticalLayout";
import {
  faceTrackForSpeaker,
  speakerAtTime,
  type SpeakerContext,
} from "@/lib/speakerContext";

export const ACTIVE_SPEAKER_VERSION = "audio-visual-speaker-v2";

export type ActiveSpeakerDecisionReason =
  | "initial"
  | "speech"
  | "speaker_change"
  | "scene_change"
  | "offscreen_hold"
  | "hold"
  | "fallback";

export type ActiveSpeakerDecision = {
  timestampSeconds: number;
  trackId?: string;
  confidence: number;
  audioActivity: number;
  visualActivity: number;
  audioVisualCorrelation: number;
  reason: ActiveSpeakerDecisionReason;
  /** Audible source-level identity, even when it is not visible. */
  speakerId?: string;
  speakerIdentityConfidence?: number;
};

export type ActiveSpeakerTimeline = {
  version: typeof ACTIVE_SPEAKER_VERSION;
  audioAvailable: boolean;
  decisions: ActiveSpeakerDecision[];
  switchCount: number;
  averageConfidence: number;
};

export type ActiveSpeakerConfig = {
  sampleStepSeconds: number;
  visualWindowSeconds: number;
  correlationWindowSeconds: number;
  minimumSpeakerHoldSeconds: number;
  switchConfirmationSeconds: number;
  switchScoreMargin: number;
  speechAudioThreshold: number;
  speechVisualThreshold: number;
  faceLossHoldSeconds: number;
};

export const DEFAULT_ACTIVE_SPEAKER_CONFIG: ActiveSpeakerConfig = {
  sampleStepSeconds: 0.25,
  visualWindowSeconds: 0.45,
  correlationWindowSeconds: 1.1,
  minimumSpeakerHoldSeconds: 0.85,
  switchConfirmationSeconds: 0.35,
  switchScoreMargin: 0.075,
  speechAudioThreshold: 0.12,
  speechVisualThreshold: 0.1,
  faceLossHoldSeconds: 0.75,
};

type SceneBoundary = {
  timestampSeconds: number;
};

type TrackVisualScale = {
  baseline: number;
  active: number;
};

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

function average(values: number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.max(0, Math.floor(fraction * sorted.length)))
  ]!;
}

function closestPoint(
  track: FaceTrack,
  timestampSeconds: number,
  maxDistanceSeconds = 0.55
): FaceTrackPoint | undefined {
  let closest: FaceTrackPoint | undefined;
  let distance = Number.POSITIVE_INFINITY;
  for (const point of track.points) {
    const nextDistance = Math.abs(point.timestampSeconds - timestampSeconds);
    if (nextDistance < distance) {
      closest = point;
      distance = nextDistance;
    }
  }
  return distance <= maxDistanceSeconds ? closest : undefined;
}

function directVisualActivity(
  track: FaceTrack,
  timestampSeconds: number,
  windowSeconds: number
): number {
  const direct = track.points
    .filter(
      (point) =>
        Math.abs(point.timestampSeconds - timestampSeconds) <= windowSeconds &&
        Number.isFinite(point.speakingActivity)
    )
    .map((point) => clamp(point.speakingActivity as number));
  if (direct.length > 0) {
    return clamp(average(direct) * 0.55 + percentile(direct, 0.75) * 0.45);
  }

  const mouth = track.points
    .filter(
      (point) =>
        Math.abs(point.timestampSeconds - timestampSeconds) <= windowSeconds &&
        Number.isFinite(point.mouthOpenRatio)
    )
    .map((point) => point.mouthOpenRatio as number);
  if (mouth.length < 3) return 0;
  const mean = average(mouth);
  const deviation = Math.sqrt(
    average(mouth.map((value) => (value - mean) ** 2))
  );
  return clamp(deviation * 9 + (Math.max(...mouth) - Math.min(...mouth)) * 2.2);
}

function visualScale(track: FaceTrack): TrackVisualScale {
  const values = track.points
    .map((point) => point.speakingActivity)
    .filter((value): value is number => Number.isFinite(value))
    .map((value) => clamp(value));
  if (values.length < 3) return { baseline: 0, active: 0.2 };
  const baseline = percentile(values, 0.2);
  return {
    baseline,
    active: Math.max(baseline + 0.08, percentile(values, 0.85)),
  };
}

function normalizedVisualActivity(
  track: FaceTrack,
  timestampSeconds: number,
  scale: TrackVisualScale,
  windowSeconds: number
): { raw: number; normalized: number } {
  const raw = directVisualActivity(track, timestampSeconds, windowSeconds);
  const relative = clamp(raw - scale.baseline, 0, 1) /
    Math.max(0.08, scale.active - scale.baseline);
  return {
    raw,
    normalized: clamp(raw * 0.38 + clamp(relative) * 0.62),
  };
}

function buildAudioSamples(tracks: FaceTrack[]): Array<{
  timestampSeconds: number;
  activity: number;
}> {
  const grouped = new Map<number, number[]>();
  for (const track of tracks) {
    for (const point of track.points) {
      if (!Number.isFinite(point.audioActivity)) continue;
      const timestampMs = Math.round(point.timestampSeconds * 1000);
      const values = grouped.get(timestampMs) ?? [];
      values.push(clamp(point.audioActivity as number));
      grouped.set(timestampMs, values);
    }
  }
  return [...grouped.entries()]
    .map(([timestampMs, values]) => ({
      timestampSeconds: timestampMs / 1000,
      activity: average(values),
    }))
    .sort((a, b) => a.timestampSeconds - b.timestampSeconds);
}

function audioActivityAt(
  samples: Array<{ timestampSeconds: number; activity: number }>,
  timestampSeconds: number,
  windowSeconds = 0.3
): number {
  const nearby = samples
    .filter(
      (sample) =>
        Math.abs(sample.timestampSeconds - timestampSeconds) <= windowSeconds
    )
    .map((sample) => sample.activity);
  return nearby.length > 0
    ? clamp(average(nearby) * 0.45 + percentile(nearby, 0.75) * 0.55)
    : 0;
}

function pearsonCorrelation(left: number[], right: number[]): number {
  if (left.length < 3 || left.length !== right.length) return 0;
  const leftMean = average(left);
  const rightMean = average(right);
  let covariance = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let index = 0; index < left.length; index++) {
    const leftDelta = left[index]! - leftMean;
    const rightDelta = right[index]! - rightMean;
    covariance += leftDelta * rightDelta;
    leftVariance += leftDelta * leftDelta;
    rightVariance += rightDelta * rightDelta;
  }
  if (leftVariance < 1e-5 || rightVariance < 1e-5) return 0;
  return clamp(
    covariance / Math.sqrt(leftVariance * rightVariance),
    0,
    1
  );
}

function audioVisualCorrelationAt(
  track: FaceTrack,
  audioSamples: Array<{ timestampSeconds: number; activity: number }>,
  timestampSeconds: number,
  scale: TrackVisualScale,
  config: ActiveSpeakerConfig
): number {
  const points = track.points.filter(
    (point) =>
      Math.abs(point.timestampSeconds - timestampSeconds) <=
      config.correlationWindowSeconds
  );
  if (points.length < 3) return 0;

  // Test a small offset in either direction because web video audio and decoded
  // frames are not always timestamped identically.
  let best = 0;
  for (const offset of [-config.sampleStepSeconds, 0, config.sampleStepSeconds]) {
    const visual: number[] = [];
    const audio: number[] = [];
    for (const point of points) {
      const activity = normalizedVisualActivity(
        track,
        point.timestampSeconds,
        scale,
        config.visualWindowSeconds
      ).normalized;
      visual.push(activity);
      audio.push(
        audioActivityAt(audioSamples, point.timestampSeconds + offset, 0.2)
      );
    }
    best = Math.max(best, pearsonCorrelation(visual, audio));
  }
  return best;
}

function crossedSceneBoundary(
  boundaries: SceneBoundary[],
  previousTime: number,
  timestampSeconds: number
): boolean {
  return boundaries.some(
    (boundary) =>
      boundary.timestampSeconds > previousTime + 1e-6 &&
      boundary.timestampSeconds <= timestampSeconds + 1e-6
  );
}

export function activeSpeakerDecisionAt(
  timeline: ActiveSpeakerTimeline | undefined,
  timestampSeconds: number
): ActiveSpeakerDecision | undefined {
  if (!timeline || timeline.decisions.length === 0) return undefined;
  let selected = timeline.decisions[0]!;
  for (const decision of timeline.decisions) {
    if (decision.timestampSeconds > timestampSeconds + 1e-6) break;
    selected = decision;
  }
  return selected;
}

/**
 * Fuse audio activity with lower-face motion to decide who is speaking.
 * Silence holds the current composition; a challenger must sustain correlated
 * evidence before a switch, while hard scene cuts reacquire immediately.
 */
export function buildAudioVisualActiveSpeakerTimeline(options: {
  tracks: FaceTrack[];
  clipStartSeconds: number;
  clipEndSeconds: number;
  primaryTrackId?: string;
  sceneChanges?: SceneBoundary[];
  speakerContext?: SpeakerContext;
  config?: Partial<ActiveSpeakerConfig>;
}): ActiveSpeakerTimeline {
  const config = { ...DEFAULT_ACTIVE_SPEAKER_CONFIG, ...options.config };
  const tracks = options.tracks.filter(
    (track) =>
      track.points.filter(
        (point) =>
          point.timestampSeconds >= options.clipStartSeconds - 0.5 &&
          point.timestampSeconds <= options.clipEndSeconds + 0.5
      ).length >= 2
  );
  const audioSamples = buildAudioSamples(tracks);
  const audioAvailable = audioSamples.length >= 3;
  const scales = new Map(tracks.map((track) => [track.id, visualScale(track)]));
  const persistence = new Map(
    tracks.map((track) => [
      track.id,
      clamp(
        track.points.length /
          Math.max(
            1,
            (options.clipEndSeconds - options.clipStartSeconds) /
              config.sampleStepSeconds
          )
      ),
    ])
  );

  let activeId: string | undefined =
    tracks.find((track) => track.id === options.primaryTrackId)?.id ??
    [...tracks].sort(
      (a, b) =>
        b.averageConfidence + (persistence.get(b.id) ?? 0) -
        (a.averageConfidence + (persistence.get(a.id) ?? 0))
    )[0]?.id;
  let activeSince = options.clipStartSeconds;
  let lastActiveVisibleAt = options.clipStartSeconds;
  let challengerId: string | undefined;
  let challengerSince = options.clipStartSeconds;
  let switchCount = 0;
  const decisions: ActiveSpeakerDecision[] = [];
  const boundaries = [...(options.sceneChanges ?? [])].sort(
    (a, b) => a.timestampSeconds - b.timestampSeconds
  );

  for (
    let timestampSeconds = options.clipStartSeconds;
    timestampSeconds <= options.clipEndSeconds + 1e-6;
    timestampSeconds += config.sampleStepSeconds
  ) {
    const previousTime =
      decisions.at(-1)?.timestampSeconds ??
      options.clipStartSeconds - config.sampleStepSeconds;
    const sceneChanged = crossedSceneBoundary(
      boundaries,
      previousTime,
      timestampSeconds
    );
    const sceneStartSeconds =
      boundaries
        .filter(
          (boundary) =>
            boundary.timestampSeconds <= timestampSeconds + 1e-6
        )
        .at(-1)?.timestampSeconds ?? options.clipStartSeconds;
    const audioActivity = audioActivityAt(audioSamples, timestampSeconds);
    const speakerInterval = speakerAtTime(
      options.speakerContext,
      timestampSeconds
    );
    const audibleSpeakerId = speakerInterval?.primarySpeakerId;
    const mappedTrackId = faceTrackForSpeaker(
      options.speakerContext,
      audibleSpeakerId
    );
    const visible = tracks
      .flatMap((track) => {
        const point = closestPoint(track, timestampSeconds);
        if (
          !point ||
          point.timestampSeconds < sceneStartSeconds - 1e-6
        ) {
          return [];
        }
        const scale = scales.get(track.id) ?? { baseline: 0, active: 0.2 };
        const visual = normalizedVisualActivity(
          track,
          timestampSeconds,
          scale,
          config.visualWindowSeconds
        );
        const correlation = audioAvailable
          ? audioVisualCorrelationAt(
              track,
              audioSamples,
              timestampSeconds,
              scale,
              config
            )
          : 0;
        const audioGate = audioAvailable ? clamp((audioActivity - 0.04) / 0.5) : 1;
        const score =
          visual.normalized * 0.45 +
          correlation * 0.27 +
          visual.raw * audioGate * 0.18 +
          point.confidence * 0.05 +
          (persistence.get(track.id) ?? 0) * 0.05 +
          (track.id === activeId ? 0.035 : 0);
        return [{ track, point, visual, correlation, score }];
      })
      .sort((a, b) => b.score - a.score);

    const current = visible.find((item) => item.track.id === activeId);
    if (current) lastActiveVisibleAt = timestampSeconds;
    const visualBest = visible[0];
    const mapped = mappedTrackId
      ? visible.find((item) => item.track.id === mappedTrackId)
      : undefined;
    const best = speakerInterval ? mapped ?? visualBest : visualBest;
    const canonicalSpeakerUnmapped = Boolean(
      speakerInterval && audibleSpeakerId && !mapped
    );
    const speechEvidence = Boolean(
      best &&
        best.visual.normalized >= config.speechVisualThreshold &&
        (!audioAvailable || audioActivity >= config.speechAudioThreshold)
    );
    let reason: ActiveSpeakerDecisionReason = decisions.length === 0
      ? "initial"
      : "hold";

    if (decisions.length === 0 && best) {
      const openingChoice = canonicalSpeakerUnmapped
        ? current ??
          visible.find((item) => item.track.id === options.primaryTrackId) ??
          best
        : (speechEvidence ? best : undefined) ?? current ?? best;
      activeId = openingChoice.track.id;
      activeSince = timestampSeconds;
      lastActiveVisibleAt = timestampSeconds;
      challengerId = undefined;
      reason = "initial";
    } else if (sceneChanged) {
      const sceneChoice =
        (mapped ?? (canonicalSpeakerUnmapped ? undefined : speechEvidence ? best : undefined)) ??
        visible.find((item) => item.track.id === options.primaryTrackId) ??
        best;
      if (sceneChoice) {
        if (activeId && activeId !== sceneChoice.track.id) switchCount += 1;
        activeId = sceneChoice.track.id;
        activeSince = timestampSeconds;
        lastActiveVisibleAt = timestampSeconds;
      }
      challengerId = undefined;
      reason = "scene_change";
    } else if (best) {
      const activeMissing =
        !current &&
        timestampSeconds - lastActiveVisibleAt >= config.faceLossHoldSeconds;
      const currentScore = current?.score ?? 0;
      const canChallenge =
        !canonicalSpeakerUnmapped &&
        best.track.id !== activeId &&
        (activeMissing ||
          (speechEvidence &&
            timestampSeconds - activeSince >= config.minimumSpeakerHoldSeconds &&
            best.score >= currentScore + config.switchScoreMargin));
      if (canChallenge) {
        if (challengerId !== best.track.id) {
          challengerId = best.track.id;
          challengerSince = timestampSeconds;
        } else if (
          timestampSeconds - challengerSince >=
          (activeMissing
            ? Math.min(0.25, config.switchConfirmationSeconds)
            : config.switchConfirmationSeconds)
        ) {
          activeId = best.track.id;
          activeSince = timestampSeconds;
          lastActiveVisibleAt = timestampSeconds;
          challengerId = undefined;
          switchCount += 1;
          reason = "speaker_change";
        }
      } else {
        challengerId = undefined;
        if (canonicalSpeakerUnmapped) reason = "offscreen_hold";
        else if (speechEvidence && best.track.id === activeId) reason = "speech";
      }
    } else if (
      timestampSeconds - lastActiveVisibleAt > config.faceLossHoldSeconds
    ) {
      activeId = undefined;
      reason = "fallback";
    }

    const selected = visible.find((item) => item.track.id === activeId);
    const runnerUp = visible.find((item) => item.track.id !== activeId);
    const margin = selected
      ? Math.max(0, selected.score - (runnerUp?.score ?? 0))
      : 0;
    const confidence = selected
      ? clamp(
          selected.point.confidence * 0.3 +
            selected.visual.normalized * 0.28 +
            selected.correlation * (audioAvailable ? 0.2 : 0) +
            clamp(margin * 3) * 0.17 +
            (audioAvailable ? audioActivity * 0.05 : 0.15)
        )
      : 0;
    decisions.push({
      timestampSeconds: Number(timestampSeconds.toFixed(3)),
      trackId: activeId,
      confidence,
      audioActivity,
      visualActivity: selected?.visual.normalized ?? 0,
      audioVisualCorrelation: selected?.correlation ?? 0,
      reason,
      ...(audibleSpeakerId ? { speakerId: audibleSpeakerId } : {}),
      ...(speakerInterval
        ? { speakerIdentityConfidence: speakerInterval.confidence }
        : {}),
    });
  }

  return {
    version: ACTIVE_SPEAKER_VERSION,
    audioAvailable,
    decisions,
    switchCount,
    averageConfidence: average(decisions.map((decision) => decision.confidence)),
  };
}
