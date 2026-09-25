import { describe, expect, it } from "vitest";
import { inferAudioVisualSpeakerMatches } from "@/lib/audioVisualSpeakerMatcher";
import {
  SPEAKER_CAPTION_PALETTE_VERSION,
  SPEAKER_CONTEXT_VERSION,
  SPEAKER_IDENTITY_RESOLVER_VERSION,
  type SpeakerContext,
} from "@/lib/speakerContext";
import { ACTIVE_SPEAKER_VERSION } from "@/lib/activeSpeaker";

function context(overlapping = false): SpeakerContext {
  return {
    version: SPEAKER_CONTEXT_VERSION,
    identityResolverVersion: SPEAKER_IDENTITY_RESOLVER_VERSION,
    paletteVersion: SPEAKER_CAPTION_PALETTE_VERSION,
    sourceSessionId: "session",
    cacheKey: "key",
    updatedAt: new Date(0).toISOString(),
    speakers: [
      {
        id: "speaker-a",
        index: 0,
        color: "#FFF4D6",
        visibility: "unknown",
        confidence: 0.9,
        providerAliases: [],
      },
      {
        id: "speaker-b",
        index: 1,
        color: "#A7F3D0",
        visibility: "unknown",
        confidence: 0.9,
        providerAliases: [],
      },
    ],
    intervals: [
      {
        startTimeSeconds: 0,
        endTimeSeconds: 2,
        speakerIds: overlapping ? ["speaker-a", "speaker-b"] : ["speaker-a"],
        primarySpeakerId: "speaker-a",
        confidence: 0.9,
        overlapping,
        source: "provider_diarization",
      },
    ],
    corrections: [],
    models: {
      diarizationProviders: ["deepgram"],
      identityResolver: SPEAKER_IDENTITY_RESOLVER_VERSION,
    },
    metrics: {
      totalWords: 2,
      attributedWords: 2,
      unresolvedWords: 0,
      overlapSeconds: overlapping ? 2 : 0,
    },
  };
}

describe("audio visual speaker matcher", () => {
  it("requires repeated synchronized evidence before mapping a face", () => {
    const decisions = Array.from({ length: 8 }, (_, index) => ({
      timestampSeconds: index * 0.25,
      trackId: "face-a",
      confidence: 0.82,
      audioActivity: 0.88,
      visualActivity: 0.91,
      audioVisualCorrelation: 0.86,
      reason: "speech" as const,
    }));
    const matches = inferAudioVisualSpeakerMatches({
      context: context(),
      visualTimeline: {
        version: ACTIVE_SPEAKER_VERSION,
        audioAvailable: true,
        decisions,
        switchCount: 0,
        averageConfidence: 0.82,
      },
    });
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      speakerId: "speaker-a",
      faceTrackId: "face-a",
    });
    expect(matches[0]!.confidence).toBeGreaterThan(0.7);
  });

  it("refuses to create a one-to-one face mapping during overlapping speech", () => {
    const matches = inferAudioVisualSpeakerMatches({
      context: context(true),
      visualTimeline: {
        version: ACTIVE_SPEAKER_VERSION,
        audioAvailable: true,
        decisions: Array.from({ length: 8 }, (_, index) => ({
          timestampSeconds: index * 0.25,
          trackId: "face-a",
          confidence: 0.9,
          audioActivity: 0.9,
          visualActivity: 0.9,
          audioVisualCorrelation: 0.9,
          reason: "speech" as const,
        })),
        switchCount: 0,
        averageConfidence: 0.9,
      },
    });
    expect(matches).toEqual([]);
  });
});
