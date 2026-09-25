import { describe, expect, it } from "vitest";
import {
  platformPackDownloadFilename,
  sanitizeDownloadTitle,
  videoDownloadFilename,
} from "@/lib/downloadFilename";

describe("download filenames", () => {
  it("uses the clip title for a general video download", () => {
    expect(videoDownloadFilename("The Moment Everything Changed!"))
      .toBe("The Moment Everything Changed.mp4");
  });

  it("adds a readable destination to platform exports", () => {
    expect(videoDownloadFilename("A Better Hook", "youtube_shorts"))
      .toBe("A Better Hook - YouTube Shorts.mp4");
    expect(videoDownloadFilename("A Better Hook", "instagram_reels"))
      .toBe("A Better Hook - Instagram Reels.mp4");
  });

  it("cleans unsafe characters without reducing the title to an id", () => {
    expect(sanitizeDownloadTitle('Creator: "Wait... what?" / Part 1'))
      .toBe("Creator Wait what Part 1");
  });

  it("provides useful fallbacks for untitled videos and packs", () => {
    expect(videoDownloadFilename(""))
      .toBe("Clipper Export.mp4");
    expect(platformPackDownloadFilename("Launch Highlights"))
      .toBe("Launch Highlights - Platform Pack.zip");
  });
});
