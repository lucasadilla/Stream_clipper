import { describe, expect, it } from "vitest";
import {
  contentTypeFromVisualClassification,
  getClipContentProfile,
  inferClipContentType,
} from "@/lib/clipContentProfile";

describe("clip content profiles", () => {
  it("recognizes podcast and interview content", () => {
    expect(
      inferClipContentType({
        title: "Founder interview - Episode 12",
        transcript: "My guest explains how the company started.",
      })
    ).toBe("podcast");
  });

  it("recognizes gaming content", () => {
    expect(
      inferClipContentType({
        title: "Marvel Rivals ranked grind",
      })
    ).toBe("gaming");
  });

  it("gives conversations longer, transcript-led clip ranges", () => {
    const podcast = getClipContentProfile("podcast");
    const gaming = getClipContentProfile("gaming");
    expect(podcast.targetMinSeconds).toBeGreaterThan(
      gaming.targetMinSeconds
    );
    expect(podcast.transcriptWeight).toBeGreaterThan(
      podcast.audioWeight
    );
    expect(gaming.audioWeight).toBeGreaterThan(gaming.transcriptWeight);
  });

  it("uses multiple visible faces as a podcast/conversation signal", () => {
    expect(contentTypeFromVisualClassification("multiple_faces")).toBe(
      "podcast"
    );
    expect(contentTypeFromVisualClassification("embedded_facecam")).toBe(
      "gaming"
    );
  });
});
