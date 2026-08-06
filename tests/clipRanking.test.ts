import { describe, expect, it } from "vitest";
import {
  isRankingEvidenceGrounded,
  isRankedTitleGrounded,
  isSpecificClickableTitle,
  sanitizeRankedClipTitle,
} from "@/services/clipRankingService";

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

  it("removes unmatched direct-quote styling", () => {
    expect(sanitizeRankedClipTitle("Host: 'The Budget Vote Changes Everything"))
      .toBe("Host: The Budget Vote Changes Everything");
  });
});

describe("contextual clip title grounding", () => {
  const context =
    "The council voted against the budget after a two hour debate.";

  it("accepts evidence copied from the matching clip", () => {
    expect(
      isRankingEvidenceGrounded("voted against the budget", context)
    ).toBe(true);
  });

  it("rejects evidence from a different clip", () => {
    expect(
      isRankingEvidenceGrounded("won the final boss fight", context)
    ).toBe(false);
  });

  it("requires the title to describe its exact evidence", () => {
    expect(
      isRankedTitleGrounded(
        "Council Rejects the Budget",
        "voted against the budget",
        context
      )
    ).toBe(true);
    expect(
      isRankedTitleGrounded(
        "Mayor Reveals a New Stadium",
        "voted against the budget",
        `${context} The mayor briefly entered the room.`
      )
    ).toBe(false);
  });
});

describe("clickable title quality gate", () => {
  it("accepts a specific title with a clear payoff", () => {
    expect(isSpecificClickableTitle("Why the Council Rejected the Budget"))
      .toBe(true);
  });

  it("rejects generic clickbait and incomplete titles", () => {
    expect(isSpecificClickableTitle("You Won't Believe What Happens Next"))
      .toBe(false);
    expect(isSpecificClickableTitle("The Mayor Finally Spoke About the"))
      .toBe(false);
    expect(isSpecificClickableTitle("Inde Navarrette on the biggest ones"))
      .toBe(false);
  });
});
