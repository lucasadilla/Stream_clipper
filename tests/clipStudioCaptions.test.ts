import { describe, expect, it } from "vitest";
import { getClipStudioCaptionWindow } from "@/lib/clipStudioPreload";
import { mergeRenderCaptionCoverage } from "@/services/renderService";

describe("Clip Studio caption coverage", () => {
  it("reuses a stable padded caption window while a trim handle moves", () => {
    expect(getClipStudioCaptionWindow(130, 155)).toEqual({
      startSeconds: 0,
      endSeconds: 360,
    });
    expect(getClipStudioCaptionWindow(132.75, 168.4)).toEqual({
      startSeconds: 0,
      endSeconds: 360,
    });
  });

  it("keeps generated cues for a newly extended range while applying client edits", () => {
    const generated = [
      { id: "a", startTimeSeconds: 10, endTimeSeconds: 12, text: "Original" },
      { id: "b", startTimeSeconds: 12, endTimeSeconds: 14, text: "New ending" },
    ];
    const client = [
      { id: "a", startTimeSeconds: 10, endTimeSeconds: 12, text: "Edited" },
    ];

    expect(mergeRenderCaptionCoverage(generated, client)).toEqual([
      { id: "a", startTimeSeconds: 10, endTimeSeconds: 12, text: "Edited" },
      { id: "b", startTimeSeconds: 12, endTimeSeconds: 14, text: "New ending" },
    ]);
  });
});
