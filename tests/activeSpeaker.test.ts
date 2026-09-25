import { describe, expect, it } from "vitest";
import {
  activeSpeakerDecisionAt,
  buildAudioVisualActiveSpeakerTimeline,
} from "@/lib/activeSpeaker";
import type { FaceTrack } from "@/lib/verticalLayout";
import {
  SPEAKER_CAPTION_PALETTE_VERSION,
  SPEAKER_CONTEXT_VERSION,
  SPEAKER_IDENTITY_RESOLVER_VERSION,
  type SpeakerContext,
} from "@/lib/speakerContext";

function speakerTrack(options: {
  id: string;
  x: number;
  activityAt: (index: number) => number;
  audioAt?: (index: number) => number | undefined;
  count?: number;
}): FaceTrack {
  const count = options.count ?? 33;
  const points = Array.from({ length: count }, (_, index) => ({
    timestampSeconds: index * 0.25,
    rect: {
      x: options.x,
      y: 0.2,
      width: 0.2,
      height: 0.3,
    },
    confidence: 0.94,
    speakingActivity: options.activityAt(index),
    audioActivity: options.audioAt?.(index),
  }));
  return {
    id: options.id,
    points,
    firstSeenSeconds: 0,
    lastSeenSeconds: (count - 1) * 0.25,
    averageConfidence: 0.94,
  };
}

describe("audio-visual active speaker detection", () => {
  it("follows a conversation using synchronized audio and mouth motion", () => {
    const audioAt = (index: number) => (index % 2 === 0 ? 0.9 : 0.34);
    const left = speakerTrack({
      id: "left",
      x: 0.08,
      audioAt,
      activityAt: (index) =>
        index < 15 ? audioAt(index) : index % 4 === 0 ? 0.09 : 0.02,
    });
    const right = speakerTrack({
      id: "right",
      x: 0.7,
      audioAt,
      activityAt: (index) =>
        index >= 15 ? audioAt(index) : index % 5 === 0 ? 0.08 : 0.02,
    });

    const timeline = buildAudioVisualActiveSpeakerTimeline({
      tracks: [left, right],
      clipStartSeconds: 0,
      clipEndSeconds: 8,
      primaryTrackId: "left",
    });

    expect(timeline.audioAvailable).toBe(true);
    expect(activeSpeakerDecisionAt(timeline, 1)?.trackId).toBe("left");
    expect(activeSpeakerDecisionAt(timeline, 7)?.trackId).toBe("right");
    expect(timeline.switchCount).toBe(1);
  });

  it("holds the current person during silence despite unrelated face motion", () => {
    const left = speakerTrack({
      id: "left",
      x: 0.08,
      audioAt: (index) => (index < 10 ? 0.8 : 0.01),
      activityAt: (index) => (index < 10 ? 0.72 : 0.02),
    });
    const right = speakerTrack({
      id: "right",
      x: 0.7,
      audioAt: (index) => (index < 10 ? 0.8 : 0.01),
      activityAt: (index) => (index >= 10 ? 0.95 : 0.02),
    });

    const timeline = buildAudioVisualActiveSpeakerTimeline({
      tracks: [left, right],
      clipStartSeconds: 0,
      clipEndSeconds: 8,
      primaryTrackId: "left",
    });

    expect(activeSpeakerDecisionAt(timeline, 7)?.trackId).toBe("left");
    expect(timeline.switchCount).toBe(0);
  });

  it("reacquires the visible speaker immediately at a hard scene cut", () => {
    const audioAt = () => 0.82;
    const left = speakerTrack({
      id: "left",
      x: 0.08,
      audioAt,
      activityAt: (index) => (index < 8 ? 0.75 : 0.02),
      count: 17,
    });
    left.points = left.points.filter((point) => point.timestampSeconds < 2);
    const right = speakerTrack({
      id: "right",
      x: 0.7,
      audioAt,
      activityAt: (index) => (index >= 8 ? 0.8 : 0.02),
      count: 17,
    });
    right.points = right.points.filter((point) => point.timestampSeconds >= 2);

    const timeline = buildAudioVisualActiveSpeakerTimeline({
      tracks: [left, right],
      clipStartSeconds: 0,
      clipEndSeconds: 4,
      primaryTrackId: "left",
      sceneChanges: [{ timestampSeconds: 2 }],
    });

    const cut = activeSpeakerDecisionAt(timeline, 2);
    expect(cut?.trackId).toBe("right");
    expect(cut?.reason).toBe("scene_change");
  });

  it("degrades to stable visual-only detection when audio is unavailable", () => {
    const left = speakerTrack({
      id: "left",
      x: 0.08,
      activityAt: (index) => (index < 15 ? 0.8 : 0.02),
    });
    const right = speakerTrack({
      id: "right",
      x: 0.7,
      activityAt: (index) => (index >= 15 ? 0.82 : 0.02),
    });
    const timeline = buildAudioVisualActiveSpeakerTimeline({
      tracks: [left, right],
      clipStartSeconds: 0,
      clipEndSeconds: 8,
      primaryTrackId: "left",
    });

    expect(timeline.audioAvailable).toBe(false);
    expect(activeSpeakerDecisionAt(timeline, 7)?.trackId).toBe("right");
  });

  it("does not follow an unrelated visible face for an off-screen voice", () => {
    const left = speakerTrack({
      id: "left",
      x: 0.08,
      audioAt: () => 0.85,
      activityAt: (index) => (index < 8 ? 0.75 : 0.02),
    });
    const right = speakerTrack({
      id: "right",
      x: 0.7,
      audioAt: () => 0.85,
      activityAt: (index) => (index >= 8 ? 0.95 : 0.02),
    });
    const speakerContext: SpeakerContext = {
      version: SPEAKER_CONTEXT_VERSION,
      identityResolverVersion: SPEAKER_IDENTITY_RESOLVER_VERSION,
      paletteVersion: SPEAKER_CAPTION_PALETTE_VERSION,
      sourceSessionId: "session",
      cacheKey: "key",
      updatedAt: new Date(0).toISOString(),
      speakers: [
        {
          id: "remote",
          index: 0,
          color: "#FFF4D6",
          visibility: "offscreen",
          confidence: 0.95,
          providerAliases: [],
        },
      ],
      intervals: [
        {
          startTimeSeconds: 0,
          endTimeSeconds: 8.1,
          speakerIds: ["remote"],
          primarySpeakerId: "remote",
          confidence: 0.95,
          overlapping: false,
          source: "provider_diarization",
        },
      ],
      corrections: [],
      models: {
        diarizationProviders: ["deepgram"],
        identityResolver: SPEAKER_IDENTITY_RESOLVER_VERSION,
      },
      metrics: {
        totalWords: 1,
        attributedWords: 1,
        unresolvedWords: 0,
        overlapSeconds: 0,
      },
    };
    const timeline = buildAudioVisualActiveSpeakerTimeline({
      tracks: [left, right],
      clipStartSeconds: 0,
      clipEndSeconds: 8,
      primaryTrackId: "left",
      speakerContext,
    });

    expect(activeSpeakerDecisionAt(timeline, 7)?.trackId).toBe("left");
    expect(activeSpeakerDecisionAt(timeline, 7)?.speakerId).toBe("remote");
    expect(activeSpeakerDecisionAt(timeline, 7)?.reason).toBe("offscreen_hold");
    expect(timeline.switchCount).toBe(0);
  });
});
