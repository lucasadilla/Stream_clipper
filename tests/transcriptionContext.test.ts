import { describe, expect, it } from "vitest";
import { buildTranscriptionContext } from "@/lib/transcriptionContext";

describe("transcription context", () => {
  it("prioritizes creator metadata and repeated chat terminology", () => {
    const context = buildTranscriptionContext({
      title: "LucasLive attempts Elden Ring: Shadow of the Erdtree",
      channelTitle: "LucasLive",
      description: "A Malenia challenge run using Rivers of Blood.",
      knownTerms: ["RTX 5090"],
      chatMessages: [
        "Malenia is next",
        "that Malenia dodge was close",
        "hello everyone",
      ],
      previousTranscript: "We are heading toward the Haligtree now.",
      language: "en",
    });

    expect(context.keyterms[0]).toBe("RTX 5090");
    expect(context.keyterms).toContain("LucasLive");
    expect(context.keyterms).toContain("Malenia");
    expect(context.keyterms.filter((term) => term === "Malenia")).toHaveLength(1);
    expect(context.prompt).toContain("Stream title:");
    expect(context.prompt).toContain("Previous transcript:");
    expect(context.language).toBe("en");
  });

  it("caps provider context and ignores common filler words", () => {
    const context = buildTranscriptionContext({
      knownTerms: Array.from({ length: 130 }, (_, index) => `Term${index}`),
      chatMessages: ["yeah yeah okay", "yeah okay really"],
      description: "x".repeat(2_000),
    });

    expect(context.keyterms).toHaveLength(100);
    expect(context.keyterms).not.toContain("yeah");
    expect(context.prompt?.length).toBeLessThanOrEqual(1_500);
  });
});
