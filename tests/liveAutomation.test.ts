import { describe, expect, it } from "vitest";
import {
  automationBroadcastKey,
  automationLiveProbeUrl,
  parseAutomationSource,
  parseDestinationAccountIds,
} from "@/lib/liveAutomation";

describe("live automation source parsing", () => {
  it("normalizes Twitch and Kick channel URLs", () => {
    expect(parseAutomationSource("twitch.tv/SomeCreator/videos")).toEqual({
      platform: "twitch",
      sourceUrl: "https://www.twitch.tv/somecreator",
      sourceKey: "somecreator",
    });
    expect(parseAutomationSource("https://kick.com/My_Channel")).toEqual({
      platform: "kick",
      sourceUrl: "https://kick.com/my_channel",
      sourceKey: "my_channel",
    });
  });

  it("normalizes YouTube handles and builds the live endpoint", () => {
    const source = parseAutomationSource("https://youtube.com/@ClipperLive");
    expect(source).toEqual({
      platform: "youtube",
      sourceUrl: "https://www.youtube.com/@clipperlive",
      sourceKey: "@clipperlive",
    });
    expect(source && automationLiveProbeUrl(source)).toBe(
      "https://www.youtube.com/@clipperlive/live"
    );
  });

  it("rejects video pages because the monitor must follow an account", () => {
    expect(
      parseAutomationSource("https://www.youtube.com/watch?v=abcdefghijk")
    ).toBeNull();
  });

  it("uses a platform broadcast id for idempotency", () => {
    expect(
      automationBroadcastKey({
        platform: "twitch",
        sourceId: "creator",
        raw: { id: "987" },
      })
    ).toBe("twitch:987");
  });

  it("deduplicates selected destination accounts", () => {
    expect(parseDestinationAccountIds(["a", " a ", "b", 2])).toEqual([
      "a",
      "b",
    ]);
  });
});
