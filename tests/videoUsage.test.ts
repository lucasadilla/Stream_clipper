import { describe, expect, it } from "vitest";
import { PRICING_PLANS } from "@/lib/pricing";
import { videoOutputUsageKeys } from "@/lib/videoUsage";

describe("video output usage", () => {
  it("counts one clip once across renders and five platform exports", () => {
    const usage = videoOutputUsageKeys({
      renderOutputs: [
        { id: "render-horizontal", clipSuggestionId: "clip-1", params: {} },
        { id: "render-vertical", clipSuggestionId: "clip-1", params: {} },
      ],
      platformOutputs: Array.from({ length: 5 }, () => ({
        clipSuggestionId: "clip-1",
      })),
    });

    expect([...usage]).toEqual(["clip:clip-1"]);
  });

  it("counts different clips as different videos", () => {
    const usage = videoOutputUsageKeys({
      renderOutputs: [
        { id: "render-1", clipSuggestionId: "clip-1", params: {} },
        { id: "render-2", clipSuggestionId: "clip-2", params: {} },
      ],
      platformOutputs: [],
    });

    expect(usage.size).toBe(2);
  });

  it("does not count preview renders", () => {
    const usage = videoOutputUsageKeys({
      renderOutputs: [
        {
          id: "preview-1",
          clipSuggestionId: "clip-1",
          params: { preview: true },
        },
      ],
      platformOutputs: [],
    });

    expect(usage.size).toBe(0);
  });
});

describe("paid plan video allowances", () => {
  it("uses 20, 100, and 200 videos with otherwise matching entitlements", () => {
    const paidPlans = PRICING_PLANS.filter((plan) => plan.id !== "business");

    expect(paidPlans.map((plan) => plan.entitlements.exportsLimit)).toEqual([
      20,
      100,
      200,
    ]);

    const withoutVideoLimit = paidPlans.map(({ entitlements }) => ({
      ...entitlements,
      plan: "paid",
      exportsLimit: null,
    }));
    expect(withoutVideoLimit[1]).toEqual(withoutVideoLimit[0]);
    expect(withoutVideoLimit[2]).toEqual(withoutVideoLimit[0]);
  });
});
