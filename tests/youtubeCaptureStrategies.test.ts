import { afterEach, describe, expect, it } from "vitest";
import fs from "fs/promises";
import {
  acquireYtDlpDeploymentLease,
  buildYoutubeCaptureAttemptPlan,
  classifyYtDlpError,
  formatYtDlpUserError,
  getYoutubeCaptureStrategies,
  getYoutubeCookieStatus,
  isYoutubePoTokenError,
  orderYoutubeCaptureStrategies,
  preferredBestAudio,
  renderSourceFormatChains,
  renderSourceFormatSort,
} from "@/services/youtubeDownloadService";

const originalClient = process.env.YT_DLP_YOUTUBE_CLIENT;
const originalAudioLang = process.env.PREFERRED_AUDIO_LANGUAGE;
const originalCookiesBase64 = process.env.YT_DLP_COOKIES_B64;
const originalCookiesPath = process.env.YT_DLP_COOKIES_PATH;

afterEach(() => {
  if (originalClient === undefined) {
    delete process.env.YT_DLP_YOUTUBE_CLIENT;
  } else {
    process.env.YT_DLP_YOUTUBE_CLIENT = originalClient;
  }
  if (originalAudioLang === undefined) {
    delete process.env.PREFERRED_AUDIO_LANGUAGE;
  } else {
    process.env.PREFERRED_AUDIO_LANGUAGE = originalAudioLang;
  }
  if (originalCookiesBase64 === undefined) {
    delete process.env.YT_DLP_COOKIES_B64;
  } else {
    process.env.YT_DLP_COOKIES_B64 = originalCookiesBase64;
  }
  if (originalCookiesPath === undefined) {
    delete process.env.YT_DLP_COOKIES_PATH;
  } else {
    process.env.YT_DLP_COOKIES_PATH = originalCookiesPath;
  }
});

describe("YouTube capture strategies", () => {
  it("falls back from mweb token capture to current cookieless clients", () => {
    process.env.YT_DLP_YOUTUBE_CLIENT = "mweb";

    const strategies = getYoutubeCaptureStrategies();

    expect(strategies[0]).toMatchObject({
      extractorArgs: "player_client=mweb",
      includeCookies: true,
    });
    expect(strategies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "default", extractorArgs: null }),
        expect.objectContaining({ id: "public-default", extractorArgs: null, includeCookies: false }),
        expect.objectContaining({ extractorArgs: "player_client=web_safari" }),
        expect.objectContaining({ id: "public-hls", extractorArgs: "player_client=web_safari", includeCookies: false }),
        expect.objectContaining({ id: "public-tv", extractorArgs: "player_client=tv_simply", includeCookies: false }),
        expect.objectContaining({ id: "public-vr", extractorArgs: "player_client=android_vr", includeCookies: false }),
      ])
    );
  });

  it("tries every independent client before spending time on a second format", () => {
    process.env.YT_DLP_YOUTUBE_CLIENT = "mweb";
    const strategies = orderYoutubeCaptureStrategies(
      getYoutubeCaptureStrategies(),
      true
    );
    const plan = buildYoutubeCaptureAttemptPlan(
      strategies,
      ["primary", "fallback"],
      2
    );

    expect(strategies.slice(0, 4).map((strategy) => strategy.id)).toEqual([
      "public-default",
      "public-hls",
      "public-tv",
      "public-vr",
    ]);
    expect(plan.slice(0, strategies.length).map((attempt) => attempt.format)).toEqual(
      Array(strategies.length).fill("primary")
    );
    expect(
      plan.slice(0, strategies.length).map((attempt) => attempt.strategy.id)
    ).toEqual(strategies.map((strategy) => strategy.id));
  });

  it("does not incorrectly tell users that cookies are the only bot-block fix", () => {
    const message = formatYtDlpUserError(
      new Error("ERROR: Sign in to confirm you're not a bot")
    );

    expect(message).toContain("cookieless");
    expect(message).toContain("egress proxy");
    expect(message).not.toContain("Refresh the Railway YouTube cookies");
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

  it("turns a YouTube media CDN 403 into an actionable error", () => {
    expect(
      classifyYtDlpError(
        new Error("ERROR: unable to download video data: HTTP Error 403: Forbidden")
      )
    ).toBe("youtube_forbidden");
  });

  it("selects seekable high-quality HLS before DASH fallbacks", () => {
    const formats = renderSourceFormatChains(2160);

    expect(formats[0]).toContain("fps>50");
    expect(formats[0]).toContain("height<=2160");
    expect(formats[0]).toContain("protocol^=m3u8");
    expect(formats[0]).toContain("format_note*=original");
    expect(formats[1]).toContain("protocol^=m3u8");
    expect(formats[3]).toContain("bestaudio[format_note*=original]/bestaudio");
    expect(formats.some((format) => format.includes("protocol^=m3u8"))).toBe(true);
    expect(formats).not.toContain("best");
  });

  it("prefers original audio and sorts language ahead of bitrate", () => {
    expect(preferredBestAudio()).toBe(
      "(bestaudio[format_note*=original]/bestaudio)"
    );
    expect(renderSourceFormatSort().startsWith("lang,")).toBe(true);

    process.env.PREFERRED_AUDIO_LANGUAGE = "en";
    expect(preferredBestAudio()).toContain("language^=en");
  });

  it("gives each capture an isolated cookie file and removes it afterward", async () => {
    delete process.env.YT_DLP_COOKIES_PATH;
    process.env.YT_DLP_COOKIES_B64 = Buffer.from(
      [
        "# Netscape HTTP Cookie File",
        "#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t2147483647\tSID\ttest-session",
        "",
      ].join("\n")
    ).toString("base64");

    const first = await acquireYtDlpDeploymentLease("youtube");
    const second = await acquireYtDlpDeploymentLease("youtube");
    expect(first.cookiePath).toBeTruthy();
    expect(second.cookiePath).toBeTruthy();
    expect(first.cookiePath).not.toBe(second.cookiePath);
    expect(first.args).toEqual(
      expect.arrayContaining(["--cookies", first.cookiePath])
    );
    expect(await fs.readFile(first.cookiePath!, "utf8")).toContain(
      "test-session"
    );

    await first.release();
    await second.release();
    await expect(fs.access(first.cookiePath!)).rejects.toThrow();
    await expect(fs.access(second.cookiePath!)).rejects.toThrow();
  });

  it("reports an expired Railway cookie secret before capture starts", async () => {
    delete process.env.YT_DLP_COOKIES_PATH;
    process.env.YT_DLP_COOKIES_B64 = Buffer.from(
      [
        "# Netscape HTTP Cookie File",
        ".youtube.com\tTRUE\t/\tTRUE\t1\tSID\texpired-session",
        "",
      ].join("\n")
    ).toString("base64");

    const status = await getYoutubeCookieStatus();
    expect(status.configured).toBe(true);
    expect(status.valid).toBe(false);
    expect(status.error).toMatch(/expired/i);
  });
});
