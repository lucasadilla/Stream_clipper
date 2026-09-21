import { afterEach, describe, expect, it } from "vitest";
import {
  classifyYtDlpError,
  getYoutubeCaptureStrategies,
  isYoutubePoTokenError,
  renderSourceFormatChains,
} from "@/services/youtubeDownloadService";

const originalClient = process.env.YT_DLP_YOUTUBE_CLIENT;

afterEach(() => {
  if (originalClient === undefined) {
    delete process.env.YT_DLP_YOUTUBE_CLIENT;
  } else {
    process.env.YT_DLP_YOUTUBE_CLIENT = originalClient;
  }
});

describe("YouTube capture strategies", () => {
  it("falls back from mweb token capture to live and no-token clients", () => {
    process.env.YT_DLP_YOUTUBE_CLIENT = "mweb";

    const strategies = getYoutubeCaptureStrategies();

    expect(strategies[0]).toMatchObject({
      extractorArgs: "player_client=mweb",
      includeCookies: true,
    });
    expect(strategies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "default", extractorArgs: null }),
        expect.objectContaining({ extractorArgs: "player_client=web_safari" }),
        expect.objectContaining({
          extractorArgs: "player_client=android_vr",
          includeCookies: false,
        }),
      ])
    );
  });

  it("deduplicates the configured provider strategy", () => {
    process.env.YT_DLP_YOUTUBE_CLIENT = "default,mweb";

    const providerStrategies = getYoutubeCaptureStrategies().filter(
      (strategy) => strategy.extractorArgs === "player_client=default,mweb"
    );

    expect(providerStrategies).toHaveLength(1);
  });

  it("recognizes the Railway GVS failure as a token error", () => {
    const error = new Error(
      "mweb client https formats require a GVS PO Token which was not provided. ERROR: No video formats found!"
    );

    expect(isYoutubePoTokenError(error)).toBe(true);
    expect(classifyYtDlpError(error)).toBe("po_token_unavailable");
  });

  it("prefers a high-resolution VP9 final source before 1080p AVC", () => {
    const formats = renderSourceFormatChains(2160);

    expect(formats[0]).toContain("vcodec^=vp9");
    expect(formats[0]).toContain("protocol^=m3u8");
    expect(formats[0]).toContain("height<=2160");
    expect(formats[1]).toContain("vcodec^=avc1");
    expect(formats[1]).toContain("protocol^=m3u8");
  });
});
