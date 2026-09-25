import { describe, expect, it } from "vitest";
import {
  alignWordsToSpeakerContext,
  remapSpeakerIntervalsToSequence,
  resolveSpeakerContext,
  speakerColorForIndex,
  type SpeakerTranscriptChunk,
} from "@/lib/speakerContext";
import { buildCaptionTrack } from "@/lib/captionTrack";
import { generateAss } from "@/lib/captionAss";
import { DEFAULT_CAPTION_APPEARANCE } from "@/lib/captionAppearance";

function chunk(options: {
  id: string;
  start: number;
  end: number;
  windowStart: number;
  windowEnd: number;
  words: Array<{
    start: number;
    end: number;
    word: string;
    speaker?: string;
  }>;
  embeddings?: Record<string, number[]>;
}): SpeakerTranscriptChunk {
  return {
    id: options.id,
    startTimeSeconds: options.start,
    endTimeSeconds: options.end,
    text: options.words.map((word) => word.word).join(" "),
    rawJson: {
      provider: "deepgram",
      segmentStart: options.windowStart,
      segmentEnd: options.windowEnd,
      words: options.words,
      speakerEmbeddings: options.embeddings,
    },
  };
}

describe("canonical speaker context", () => {
  it("recognizes returning speakers when provider-local IDs change across windows", () => {
    const chunks = [
      chunk({
        id: "w1",
        start: 0,
        end: 4,
        windowStart: 0,
        windowEnd: 10,
        embeddings: { "0": [1, 0, 0], "1": [0, 1, 0] },
        words: [
          { start: 0, end: 0.5, word: "hello", speaker: "0" },
          { start: 3, end: 3.5, word: "hi", speaker: "1" },
        ],
      }),
      chunk({
        id: "w2",
        start: 20,
        end: 24,
        windowStart: 20,
        windowEnd: 30,
        embeddings: { "7": [0.998, 0.02, 0], "9": [0.01, 0.997, 0] },
        words: [
          { start: 20, end: 20.5, word: "again", speaker: "7" },
          { start: 23, end: 23.5, word: "reply", speaker: "9" },
        ],
      }),
    ];
    const resolved = resolveSpeakerContext({
      sourceSessionId: "session-a",
      cacheKey: "one",
      chunks,
      now: "2026-01-01T00:00:00.000Z",
    });

    expect(resolved.context.speakers).toHaveLength(2);
    expect(resolved.wordsByChunkId.get("w2")?.[0]?.speakerId).toBe(
      resolved.wordsByChunkId.get("w1")?.[0]?.speakerId
    );
    expect(resolved.wordsByChunkId.get("w2")?.[1]?.speakerId).toBe(
      resolved.wordsByChunkId.get("w1")?.[1]?.speakerId
    );
  });

  it("does not assume the same provider label means the same person in a distant window", () => {
    const resolved = resolveSpeakerContext({
      sourceSessionId: "session-b",
      cacheKey: "two",
      chunks: [
        chunk({
          id: "first",
          start: 0,
          end: 1,
          windowStart: 0,
          windowEnd: 10,
          words: [{ start: 0, end: 0.5, word: "one", speaker: "0" }],
        }),
        chunk({
          id: "later",
          start: 50,
          end: 51,
          windowStart: 50,
          windowEnd: 60,
          words: [{ start: 50, end: 50.5, word: "two", speaker: "0" }],
        }),
      ],
    });
    expect(resolved.context.speakers).toHaveLength(2);
    expect(resolved.wordsByChunkId.get("first")?.[0]?.speakerId).not.toBe(
      resolved.wordsByChunkId.get("later")?.[0]?.speakerId
    );
  });

  it("preserves overlapping speakers and leaves ambiguous boundary words unknown", () => {
    const resolved = resolveSpeakerContext({
      sourceSessionId: "session-c",
      cacheKey: "three",
      chunks: [
        chunk({
          id: "overlap",
          start: 0,
          end: 2,
          windowStart: 0,
          windowEnd: 5,
          words: [
            { start: 0, end: 1.2, word: "wait", speaker: "0" },
            { start: 0.8, end: 1.5, word: "look", speaker: "1" },
          ],
        }),
      ],
    });
    expect(resolved.context.intervals.some((interval) => interval.overlapping)).toBe(true);
    expect(
      resolved.wordsByChunkId.get("overlap")?.[0]?.overlappingSpeakerIds
    ).toHaveLength(1);

    const aligned = alignWordsToSpeakerContext(
      [{ start: 0.9, end: 1.1, word: "uh" }],
      resolved.context
    );
    expect(aligned[0]?.speakerId).toBeUndefined();
    expect(aligned[0]?.overlappingSpeakerIds?.length).toBeGreaterThan(0);

    const corrected = alignWordsToSpeakerContext(
      [
        {
          start: 0.9,
          end: 1.1,
          word: "uh",
          speakerId: resolved.context.speakers[0]!.id,
          speakerAssignmentSource: "creator_override",
        },
      ],
      resolved.context
    );
    expect(corrected[0]?.speakerId).toBe(resolved.context.speakers[0]!.id);
    expect(corrected[0]?.speakerConfidence).toBe(1);
  });

  it("keeps colors and source identities stable through multi-cut remapping", () => {
    expect(speakerColorForIndex(1)).toBe(speakerColorForIndex(1));
    const mapped = remapSpeakerIntervalsToSequence(
      [
        {
          startTimeSeconds: 10,
          endTimeSeconds: 12,
          speakerIds: ["speaker-a"],
          primarySpeakerId: "speaker-a",
          confidence: 0.9,
          overlapping: false,
          source: "provider_diarization",
        },
        {
          startTimeSeconds: 30,
          endTimeSeconds: 31,
          speakerIds: ["speaker-a"],
          primarySpeakerId: "speaker-a",
          confidence: 0.9,
          overlapping: false,
          source: "provider_diarization",
        },
      ],
      [
        { sourceStart: 10, sourceEnd: 12 },
        { sourceStart: 30, sourceEnd: 31 },
      ]
    );
    expect(mapped.map((interval) => interval.primarySpeakerId)).toEqual([
      "speaker-a",
      "speaker-a",
    ]);
    expect(mapped[1]?.startTimeSeconds).toBe(2);
  });

  it("splits captions at confident speaker boundaries and burns stable colors", () => {
    const chunks = [
      chunk({
        id: "dialogue",
        start: 0,
        end: 2,
        windowStart: 0,
        windowEnd: 5,
        words: [
          { start: 0, end: 0.4, word: "Hello", speaker: "0" },
          { start: 0.45, end: 0.8, word: "there.", speaker: "0" },
          { start: 0.9, end: 1.2, word: "Hi", speaker: "1" },
          { start: 1.25, end: 1.7, word: "back.", speaker: "1" },
        ],
      }),
    ];
    const resolved = resolveSpeakerContext({
      sourceSessionId: "session-d",
      cacheKey: "four",
      chunks,
    });
    const rawJson = {
      ...(chunks[0]!.rawJson as Record<string, unknown>),
      words: resolved.wordsByChunkId.get("dialogue"),
    };
    const cues = buildCaptionTrack(
      [{ ...chunks[0]!, rawJson }],
      "vertical",
      { speakerContext: resolved.context }
    );
    expect(cues).toHaveLength(2);
    expect(cues[0]?.speakerId).not.toBe(cues[1]?.speakerId);
    expect(cues[0]?.speakerColor).toBe(resolved.context.speakers[0]?.color);

    const ass = generateAss({
      cues,
      appearance: DEFAULT_CAPTION_APPEARANCE,
      width: 1080,
      height: 1920,
      syncMode: "precise",
    });
    expect(ass).toContain("\\c&H");
    expect(ass.match(/^Dialogue: 0,/gm)).toHaveLength(2);
  });
});
