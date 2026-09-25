import {
  speakerAtTime,
  type SpeakerContext,
} from "@/lib/speakerContext";
import type { ActiveSpeakerTimeline } from "@/lib/activeSpeaker";

export const AUDIO_VISUAL_SPEAKER_MATCHER_VERSION =
  "audio-visual-speaker-matcher-v1" as const;

export interface AudioVisualSpeakerMatch {
  speakerId: string;
  faceTrackId: string;
  confidence: number;
  evidenceSeconds: number;
  sampleCount: number;
}

type Evidence = {
  score: number;
  count: number;
  seconds: number;
};

/**
 * Aggregate repeated audio/visual synchronization before binding a voice to a
 * face. Single-face presence is never evidence by itself, and overlap is
 * excluded because it cannot establish a one-to-one identity.
 */
export function inferAudioVisualSpeakerMatches(options: {
  context: SpeakerContext;
  visualTimeline: ActiveSpeakerTimeline;
  minimumEvidenceSeconds?: number;
  minimumConfidence?: number;
}): AudioVisualSpeakerMatch[] {
  const step = Math.max(
    0.05,
    options.visualTimeline.decisions[1]
      ? options.visualTimeline.decisions[1].timestampSeconds -
          options.visualTimeline.decisions[0]!.timestampSeconds
      : 0.25
  );
  const evidence = new Map<string, Evidence>();

  for (const decision of options.visualTimeline.decisions) {
    if (!decision.trackId || decision.confidence < 0.32) continue;
    const interval = speakerAtTime(options.context, decision.timestampSeconds);
    if (
      !interval?.primarySpeakerId ||
      interval.overlapping ||
      interval.confidence < 0.55
    ) {
      continue;
    }
    const synchronization =
      decision.visualActivity * 0.42 +
      decision.audioVisualCorrelation * 0.38 +
      decision.audioActivity * 0.08 +
      decision.confidence * 0.12;
    if (synchronization < 0.28) continue;
    const key = `${interval.primarySpeakerId}|${decision.trackId}`;
    const current = evidence.get(key) ?? { score: 0, count: 0, seconds: 0 };
    current.score += synchronization;
    current.count += 1;
    current.seconds += step;
    evidence.set(key, current);
  }

  const bySpeaker = new Map<
    string,
    Array<{ trackId: string; evidence: Evidence; mean: number }>
  >();
  for (const [key, item] of evidence) {
    const splitAt = key.indexOf("|");
    const speakerId = key.slice(0, splitAt);
    const trackId = key.slice(splitAt + 1);
    const rows = bySpeaker.get(speakerId) ?? [];
    rows.push({ trackId, evidence: item, mean: item.score / item.count });
    bySpeaker.set(speakerId, rows);
  }

  const candidates = [...bySpeaker.entries()].flatMap(([speakerId, rows]) => {
    const ranked = rows.sort(
      (left, right) =>
        right.evidence.seconds * right.mean - left.evidence.seconds * left.mean
    );
    const best = ranked[0];
    if (!best) return [];
    const runnerUp = ranked[1];
    const minimumEvidence = options.minimumEvidenceSeconds ?? 1.25;
    const dominance = runnerUp
      ? best.evidence.score /
        Math.max(0.01, best.evidence.score + runnerUp.evidence.score)
      : 1;
    const confidence = Math.min(
      1,
      best.mean * 0.68 +
        dominance * 0.22 +
        Math.min(1, best.evidence.seconds / 4) * 0.1
    );
    if (
      best.evidence.seconds < minimumEvidence ||
      best.evidence.count < 3 ||
      dominance < 0.64 ||
      confidence < (options.minimumConfidence ?? 0.62)
    ) {
      return [];
    }
    return [{
      speakerId,
      faceTrackId: best.trackId,
      confidence,
      evidenceSeconds: best.evidence.seconds,
      sampleCount: best.evidence.count,
    }];
  });

  // A face track cannot establish two voice identities in the same analysis.
  const claimedTracks = new Set<string>();
  return candidates
    .sort((left, right) => right.confidence - left.confidence)
    .filter((candidate) => {
      if (claimedTracks.has(candidate.faceTrackId)) return false;
      claimedTracks.add(candidate.faceTrackId);
      return true;
    });
}
