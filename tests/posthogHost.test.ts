import { describe, expect, it } from "vitest";
import {
  getPosthogAssetHost,
  getPosthogUiHost,
  isPosthogEuHost,
} from "@/lib/posthogHost";

describe("PostHog host helpers", () => {
  it("maps US ingest to US UI and assets", () => {
    expect(isPosthogEuHost("https://us.i.posthog.com")).toBe(false);
    expect(getPosthogUiHost("https://us.i.posthog.com")).toBe(
      "https://us.posthog.com"
    );
    expect(getPosthogAssetHost("https://us.i.posthog.com")).toBe(
      "https://us-assets.i.posthog.com"
    );
  });

  it("maps EU ingest to EU UI and assets", () => {
    expect(isPosthogEuHost("https://eu.i.posthog.com")).toBe(true);
    expect(getPosthogUiHost("https://eu.i.posthog.com")).toBe(
      "https://eu.posthog.com"
    );
    expect(getPosthogAssetHost("https://eu.i.posthog.com")).toBe(
      "https://eu-assets.i.posthog.com"
    );
  });
});
