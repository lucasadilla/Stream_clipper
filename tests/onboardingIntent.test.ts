import { describe, expect, it } from "vitest";
import {
  isOnboardingIntent,
  mergeOnboardingIntent,
} from "@/lib/onboardingIntent";
import {
  parseOnboardingIntentCookie,
  serializeOnboardingIntent,
} from "@/services/onboardingIntentService";
import {
  parseBillingAccountCookie,
  serializeBillingAccountCookie,
} from "@/lib/stripe";

describe("onboarding intent", () => {
  it("preserves workflow context while a plan is selected later", () => {
    const started = mergeOnboardingIntent(
      null,
      {
        workflow: "agent",
        streamUrl: "https://youtu.be/abcdefghijk",
        requestedAction: "Find the funniest reactions",
        attribution: { utmSource: "reddit" },
      },
      1_000
    );
    const priced = mergeOnboardingIntent(
      started,
      { planId: "pro", interval: "yearly" },
      2_000
    );

    expect(priced).toMatchObject({
      workflow: "agent",
      streamUrl: "https://www.youtube.com/watch?v=abcdefghijk",
      requestedAction: "Find the funniest reactions",
      planId: "pro",
      interval: "yearly",
      attribution: { utmSource: "reddit" },
      createdAt: 1_000,
    });
  });

  it("rejects unsupported stream URLs before they enter onboarding", () => {
    expect(() =>
      mergeOnboardingIntent(null, { streamUrl: "https://example.com/video" })
    ).toThrow(/YouTube, Twitch, or Kick/);
  });

  it("signs intent state and rejects tampering", () => {
    const intent = mergeOnboardingIntent(null, { workflow: "autopilot" });
    const cookie = serializeOnboardingIntent(intent);
    expect(parseOnboardingIntentCookie(cookie)).toEqual(intent);
    expect(parseOnboardingIntentCookie(`${cookie}x`)).toBeNull();
    expect(isOnboardingIntent({ ...intent, expiresAt: 0 })).toBe(false);
  });
});

describe("billing account cookie", () => {
  it("accepts signed account ids and rejects forged values", () => {
    const cookie = serializeBillingAccountCookie("account_123");
    expect(parseBillingAccountCookie(cookie)).toBe("account_123");
    expect(parseBillingAccountCookie("account_admin.fake-signature")).toBeNull();
    expect(parseBillingAccountCookie("account_123")).toBeNull();
  });
});
