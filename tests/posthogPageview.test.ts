import { describe, expect, it, vi } from "vitest";
import {
  buildPosthogPageviewUrl,
  capturePosthogPageview,
} from "@/lib/posthogPageview";

describe("buildPosthogPageviewUrl", () => {
  it("builds an absolute URL for the landing path", () => {
    expect(
      buildPosthogPageviewUrl("https://streamclipper.stream", "/")
    ).toBe("https://streamclipper.stream/");
  });

  it("keeps query params that Web Analytics uses for attribution", () => {
    expect(
      buildPosthogPageviewUrl(
        "https://streamclipper.stream/",
        "/login",
        "utm_source=twitter"
      )
    ).toBe("https://streamclipper.stream/login?utm_source=twitter");
  });

  it("accepts a search string that already starts with ?", () => {
    expect(
      buildPosthogPageviewUrl("https://example.com", "/welcome", "?ref=home")
    ).toBe("https://example.com/welcome?ref=home");
  });
});

describe("capturePosthogPageview", () => {
  it("does not capture until the SDK has loaded", () => {
    const capture = vi.fn();
    expect(
      capturePosthogPageview(
        { __loaded: false, capture },
        { origin: "https://streamclipper.stream", pathname: "/" }
      )
    ).toBe(false);
    expect(capture).not.toHaveBeenCalled();
  });

  it("sends an instant $pageview with the full current URL", () => {
    const capture = vi.fn();
    expect(
      capturePosthogPageview(
        { __loaded: true, capture },
        {
          origin: "https://streamclipper.stream",
          pathname: "/login",
          search: "next=/sessions",
        }
      )
    ).toBe(true);
    expect(capture).toHaveBeenCalledWith(
      "$pageview",
      { $current_url: "https://streamclipper.stream/login?next=/sessions" },
      { send_instantly: true }
    );
  });
});
