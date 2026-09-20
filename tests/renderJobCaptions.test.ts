import { describe, expect, it } from "vitest";
import { parseRenderJobParams } from "@/services/renderService";

const requiredParams = {
  streamSessionId: "session-1",
  startTimeSeconds: 10,
  endTimeSeconds: 25,
};

describe("render job caption defaults", () => {
  it("keeps captions enabled when an older caller omits the flag", () => {
    expect(parseRenderJobParams(requiredParams)?.includeCaptions).toBe(true);
  });

  it("respects an explicit request to disable captions", () => {
    expect(
      parseRenderJobParams({ ...requiredParams, includeCaptions: false })
        ?.includeCaptions
    ).toBe(false);
  });
});
