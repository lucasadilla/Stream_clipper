import { describe, expect, it } from "vitest";
import {
  buildDeepgramUrl,
  parseDeepgramTranscription,
} from "@/services/deepgramTranscription";
import { shouldUseDeepgramForWorkload } from "@/services/transcriptionRouterService";

describe("Deepgram transcription parsing", () => {
  it("uses the current versioned diarizer by default with an explicit opt-out", () => {
    const previousDiarize = process.env.DEEPGRAM_DIARIZE;
    const previousModel = process.env.DEEPGRAM_DIARIZE_MODEL;
    try {
      delete process.env.DEEPGRAM_DIARIZE;
      delete process.env.DEEPGRAM_DIARIZE_MODEL;
      expect(new URL(buildDeepgramUrl({ keyterms: [] })).searchParams.get("diarize_model"))
        .toBe("latest");
      process.env.DEEPGRAM_DIARIZE_MODEL = "v2";
      expect(new URL(buildDeepgramUrl({ keyterms: [] })).searchParams.get("diarize_model"))
        .toBe("v2");
      process.env.DEEPGRAM_DIARIZE = "false";
      expect(new URL(buildDeepgramUrl({ keyterms: [] })).searchParams.has("diarize_model"))
        .toBe(false);
    } finally {
      if (previousDiarize === undefined) delete process.env.DEEPGRAM_DIARIZE;
      else process.env.DEEPGRAM_DIARIZE = previousDiarize;
      if (previousModel === undefined) delete process.env.DEEPGRAM_DIARIZE_MODEL;
      else process.env.DEEPGRAM_DIARIZE_MODEL = previousModel;
    }
  });

  it("prefers diarized transcription for both live and VOD unless explicitly overridden", () => {
    const previousKey = process.env.DEEPGRAM_API_KEY;
    const previousLive = process.env.TRANSCRIPTION_LIVE_PROVIDER;
    const previousVod = process.env.TRANSCRIPTION_VOD_PROVIDER;
    try {
      process.env.DEEPGRAM_API_KEY = "test-key";
      delete process.env.TRANSCRIPTION_LIVE_PROVIDER;
      delete process.env.TRANSCRIPTION_VOD_PROVIDER;
      expect(shouldUseDeepgramForWorkload("live")).toBe(true);
      expect(shouldUseDeepgramForWorkload("vod")).toBe(true);
      process.env.TRANSCRIPTION_VOD_PROVIDER = "whisper";
      expect(shouldUseDeepgramForWorkload("vod")).toBe(false);
    } finally {
      if (previousKey === undefined) delete process.env.DEEPGRAM_API_KEY;
      else process.env.DEEPGRAM_API_KEY = previousKey;
      if (previousLive === undefined) delete process.env.TRANSCRIPTION_LIVE_PROVIDER;
      else process.env.TRANSCRIPTION_LIVE_PROVIDER = previousLive;
      if (previousVod === undefined) delete process.env.TRANSCRIPTION_VOD_PROVIDER;
      else process.env.TRANSCRIPTION_VOD_PROVIDER = previousVod;
    }
  });

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
