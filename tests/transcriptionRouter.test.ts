import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transcribeWhisperAudio: vi.fn(),
}));

vi.mock("@/services/deepgramTranscription", () => ({
  isDeepgramConfigured: () => false,
  transcribeDeepgramAudio: vi.fn(),
}));

vi.mock("@/services/whisperTranscription", () => ({
  isWhisperAvailable: () => true,
  transcribeWhisperAudio: mocks.transcribeWhisperAudio,
}));

import { transcribeAudioWithRouter } from "@/services/transcriptionRouterService";

describe("transcription routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transcribeWhisperAudio.mockResolvedValue([]);
  });

  it("keeps metadata out of Whisper's timestamp prompt", async () => {
    await transcribeAudioWithRouter("audio.wav", 12, {
      workload: "vod",
      context: {
        prompt: "Stream title: Bro why are you saying LOL?",
        keyterms: ["LucasLive", "Elden Ring"],
        language: "en",
      },
    });

    expect(mocks.transcribeWhisperAudio).toHaveBeenCalledWith(
      "audio.wav",
      12,
      {
        language: "en",
        keyterms: ["LucasLive", "Elden Ring"],
      }
    );
  });
});
