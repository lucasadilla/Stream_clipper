import { describe, expect, it } from "vitest";
import { parseDeepgramTranscription } from "@/services/deepgramTranscription";

describe("Deepgram transcription parsing", () => {
  it("preserves absolute word timing, confidence, and speaker metadata", () => {
    const segments = parseDeepgramTranscription(
      {
        results: {
          utterances: [
            {
              start: 0.25,
              end: 1.4,
              transcript: "Welcome to Clipper.",
              confidence: 0.9,
              words: [
                {
                  start: 0.25,
                  end: 0.7,
                  word: "welcome",
                  punctuated_word: "Welcome",
                  confidence: 0.98,
                  speaker: 0,
                },
                {
                  start: 0.75,
                  end: 1.05,
                  word: "to",
                  confidence: 0.95,
                  speaker: 0,
                },
                {
                  start: 1.08,
                  end: 1.4,
                  word: "clipper",
                  punctuated_word: "Clipper.",
                  confidence: 0.99,
                  speaker: 0,
                },
              ],
            },
          ],
        },
      },
      120,
      "nova-3"
    );

    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({
      startTimeSeconds: 120.25,
      endTimeSeconds: 121.4,
      text: "Welcome to Clipper.",
      provider: "deepgram",
      model: "nova-3",
      timingModel: "nova-3",
      estimatedTiming: false,
    });
    expect(segments[0]!.words?.[0]).toMatchObject({
      start: 120.25,
      end: 120.7,
      word: "Welcome",
      confidence: 0.98,
      speaker: "0",
    });
    expect(segments[0]!.confidence).toBeCloseTo((0.98 + 0.95 + 0.99) / 3);
  });

  it("falls back to the channel alternative when utterances are absent", () => {
    const segments = parseDeepgramTranscription(
      {
        results: {
          channels: [
            {
              alternatives: [
                {
                  transcript: "One clean fallback.",
                  confidence: 0.87,
                  words: [
                    { start: 2, end: 2.2, word: "One" },
                    { start: 2.2, end: 2.5, word: "clean" },
                    { start: 2.5, end: 3, word: "fallback." },
                  ],
                },
              ],
            },
          ],
        },
      },
      10
    );

    expect(segments[0]).toMatchObject({
      startTimeSeconds: 12,
      endTimeSeconds: 13,
      text: "One clean fallback.",
      provider: "deepgram",
    });
  });
});
