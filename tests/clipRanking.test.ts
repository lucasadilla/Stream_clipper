import { describe, expect, it } from "vitest";
import { sanitizeRankedClipTitle } from "@/services/clipRankingService";

describe("contextual clip title cleanup", () => {
  it("removes ellipses and trailing punctuation", () => {
    expect(sanitizeRankedClipTitle("  The Mayor Finally Answers...  ")).toBe(
      "The Mayor Finally Answers"
    );
  });

  it("rejects generic clickbait titles", () => {
    expect(sanitizeRankedClipTitle("Insane Stream Moment")).toBe("");
    expect(sanitizeRankedClipTitle("You Won't Believe This")).toBe("");
  });

  it("keeps a specific grounded title", () => {
    expect(
      sanitizeRankedClipTitle("Why the Council Rejected the Budget")
    ).toBe("Why the Council Rejected the Budget");
  });
});
