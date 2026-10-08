import { describe, expect, it } from "vitest";
import {
  isRankingEvidenceGrounded,
  isRankedTitleGrounded,
  isSpecificClickableTitle,
  sanitizeRankedClipTitle,
} from "@/services/clipRankingService";
import { buildSpecificClipTitle } from "@/lib/clipDescriptions";

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
    expect(
      isSpecificClickableTitle("With One HP Left, Tarik Wins the Round")
    ).toBe(true);
  });

  it("rejects generic clickbait and incomplete titles", () => {
    expect(isSpecificClickableTitle("You Won't Believe What Happens Next"))
      .toBe(false);
    expect(isSpecificClickableTitle("The Mayor Finally Spoke About the"))
      .toBe(false);
    expect(isSpecificClickableTitle("Inde Navarrette on the biggest ones"))
      .toBe(false);
    expect(
      isSpecificClickableTitle("Bro why you saying LOL Bro what s so f")
    ).toBe(false);
    expect(
      isSpecificClickableTitle("Creator Explains Why Creator Explains Why")
    ).toBe(false);
    expect(
      isSpecificClickableTitle(
        "Of Because It's You Know Hugely Profitable You Feel Like"
      )
    ).toBe(false);
    expect(
      isSpecificClickableTitle("Because The Business Became Hugely Profitable")
    ).toBe(false);
    expect(
      isSpecificClickableTitle(
        "He Got The Part On An Ongoing Basis That's Why"
      )
    ).toBe(false);
    expect(
      isSpecificClickableTitle("A Significant Visual Scene Change Was Detected")
    ).toBe(false);
  });
});

describe("fallback clip title writing", () => {
  it("prefers the concrete payoff over a flat middle sentence", () => {
    expect(
      buildSpecificClipTitle({
        startTimeSeconds: 20,
        endTimeSeconds: 50,
        transcriptText:
          "I started with the old camera. The setup took a while. But the new camera finally worked because I changed the cable!",
      })
    ).toContain("New Camera Finally Worked");
  });

  it("cleans broken ASR contractions and dangling fragments", () => {
    const title = buildSpecificClipTitle({
      startTimeSeconds: 0,
      endTimeSeconds: 30,
      transcriptText: "what s happening with the camera right now f",
    });
    expect(title).toContain("What's");
    expect(title).not.toMatch(/\sf$/i);
  });

  it("uses grounded event context instead of a broken transcript fragment", () => {
    expect(
      buildSpecificClipTitle({
        startTimeSeconds: 0,
        endTimeSeconds: 30,
        transcriptText:
          "of because it's you know hugely profitable you feel like",
        eventSummary:
          "The startup's subscription model became hugely profitable",
      })
    ).toBe("The Startup's Subscription Model Became Hugely Profitable");
  });
});
