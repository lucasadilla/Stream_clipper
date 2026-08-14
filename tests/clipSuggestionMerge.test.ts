import { describe, expect, it } from "vitest";
import { mergeClipSuggestions } from "@/lib/clipSuggestionMerge";

describe("mergeClipSuggestions", () => {
  const oldClips = [
    { id: "old-2", title: "Second" },
    { id: "old-1", title: "First" },
  ];

  it("keeps the current list when a refresh is empty", () => {
    expect(mergeClipSuggestions(oldClips, [])).toBe(oldClips);
  });

  it("adds new clips to the top without clearing existing cards", () => {
    const merged = mergeClipSuggestions(oldClips, [
      { id: "new-2", title: "Newest" },
      { id: "new-1", title: "New" },
    ]);

    expect(merged.map((clip) => clip.id)).toEqual([
      "new-2",
      "new-1",
      "old-2",
      "old-1",
    ]);
  });

  it("updates matching clips without moving or deleting other clips", () => {
    const merged = mergeClipSuggestions(oldClips, [
      { id: "old-1", title: "Updated" },
    ]);

    expect(merged).toEqual([
      { id: "old-2", title: "Second" },
      { id: "old-1", title: "Updated" },
    ]);
  });
});
