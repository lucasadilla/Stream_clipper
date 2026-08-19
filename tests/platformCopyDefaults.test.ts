import { describe, expect, it } from "vitest";
import { buildSpecificClipReason } from "@/lib/clipDescriptions";
import {
  buildFallbackPlatformCopy,
  extractPublishingKeywords,
  stripInternalClipCopy,
} from "@/lib/platformCopyDefaults";

const context = {
  clipTitle: "Taylor Swift Explains the Surprise Song Choice",
  clipReason: "Great 45s Short candidate at 24:37. Hook line: Taylor explains why the song changed.",
  transcriptText:
    "Taylor Swift explains why she changed the surprise song at the last minute. The crowd reaction made the decision worth it.",
  streamTitle: "Taylor Swift Eras Tour Breakdown",
  streamerName: "Culture Desk",
  durationSeconds: 45,
};

describe("platform-ready fallback copy", () => {
  it("uses grounded names and never exposes producer notes", () => {
    const copy = buildFallbackPlatformCopy({
      platform: "youtube_shorts",
      ...context,
    });

    expect(copy.title).toContain("Taylor Swift");
    expect(copy.description).toContain("surprise song");
    expect(copy.description).not.toMatch(/candidate|24:37/i);
    expect(copy.caption).toBeNull();
    expect(copy.hashtags).toContain("#TaylorSwift");
    expect(copy.tags).toContain("Taylor Swift");
    expect(copy.thumbnailText).toBeTruthy();
    expect(copy.pinnedComment).toContain("Taylor Swift");
  });

  it("creates an X package within the platform limit without irrelevant fields", () => {
    const copy = buildFallbackPlatformCopy({ platform: "x", ...context });
    expect(copy.postText?.length).toBeLessThanOrEqual(280);
    expect(copy.caption).toBeNull();
    expect(copy.description).toBeNull();
    expect(copy.hashtags.length).toBeLessThanOrEqual(2);
  });

  it("extracts searchable proper names ahead of generic stream words", () => {
    const keywords = extractPublishingKeywords(context);
    expect(keywords[0]).toBe("Taylor Swift");
    expect(keywords).not.toContain("Short");
    expect(stripInternalClipCopy(context.clipReason)).not.toMatch(/candidate|24:37/i);
  });
});

describe("clip descriptions", () => {
  it("stores public context instead of ranking diagnostics", () => {
    const description = buildSpecificClipReason({
      startTimeSeconds: 1477,
      endTimeSeconds: 1522,
      transcriptText: context.transcriptText,
    });
    expect(description).toContain("Taylor Swift");
    expect(description).not.toMatch(/Great 45s|candidate|24:37/i);
  });
});
