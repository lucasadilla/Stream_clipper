import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  command: vi.fn(),
  decode: vi.fn(),
  probe: vi.fn(),
}));

vi.mock("@/lib/ffmpeg", () => ({
  runCommand: mocks.command,
  canDecodeVideoFrame: mocks.decode,
  probeMedia: mocks.probe,
  getFfmpegPath: () => "ffmpeg",
}));

import { downloadClipSegmentFromStream } from "@/services/youtubeDownloadService";

function downloads(): string[][] {
  return mocks.command.mock.calls
    .map((call) => call[1] as string[])
    .filter((args) => args.includes("--download-sections"));
}

const capture = () => downloadClipSegmentFromStream(
  "https://www.youtube.com/watch?v=Y6WCsT8mc_A", "08:04", "08:46",
  "format-recovery-test.mp4", { timeoutMs: 120_000, minVideoHeight: 720 }
);

describe("clip source format recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("YT_DLP_COOKIES_B64", "");
    vi.stubEnv("YT_DLP_COOKIES_PATH", "");
    vi.stubEnv("YT_DLP_YOUTUBE_CLIENT", "mweb");
    mocks.command.mockResolvedValue({ stdout: "", stderr: "" });
    mocks.decode.mockResolvedValue(true);
    mocks.probe.mockResolvedValue({ width: 1920, height: 1080 });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("recovers an audio-only VP9 HLS cut through HD AVC before rotating clients", async () => {
    mocks.decode.mockResolvedValueOnce(false);
    await capture();
    const attempts = downloads();
    expect(attempts).toHaveLength(2);
    expect(attempts[0]![attempts[0]!.indexOf("-f") + 1]).not.toContain("vcodec^=avc1");
    expect(attempts[1]![attempts[1]!.indexOf("-f") + 1]).toContain("vcodec^=avc1");
    expect(attempts.every((args) => !args.includes("youtube:player_client=web_safari"))).toBe(true);
  });

  it("tries a different HD format immediately when the download is below the quality floor", async () => {
    mocks.probe.mockResolvedValueOnce({ width: 640, height: 360 });
    await capture();
    const attempts = downloads();
    expect(attempts).toHaveLength(2);
    expect(attempts[1]![attempts[1]!.indexOf("-f") + 1]).toContain("vcodec^=avc1");
  });

  it("reaches non-HLS HD formats when this client offers no HLS video", async () => {
    mocks.command.mockImplementation(async (_command, args: string[]) => {
      if (args.includes("--download-sections") && args[args.indexOf("-f") + 1]!.includes("protocol^=m3u8")) {
        throw new Error("ERROR: Requested format is not available");
      }
      return { stdout: "", stderr: "" };
    });
    await capture();
    const attempts = downloads();
    expect(attempts).toHaveLength(4);
    expect(attempts[3]![attempts[3]!.indexOf("-f") + 1]).not.toContain("protocol^=m3u8");
  });

  it("still switches clients first for an authentication challenge", async () => {
    let challenged = false;
    mocks.command.mockImplementation(async (_command, args: string[]) => {
      if (args.includes("--download-sections") && !challenged) {
        challenged = true;
        throw new Error("ERROR: Sign in to confirm you're not a bot");
      }
      return { stdout: "", stderr: "" };
    });
    await capture();
    const attempts = downloads();
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toContain("youtube:player_client=web_safari");
    expect(attempts[1]![attempts[1]!.indexOf("-f") + 1]).toBe(attempts[0]![attempts[0]!.indexOf("-f") + 1]);
  });

  it("stops on disk exhaustion instead of retrying until a misleading timeout", async () => {
    mocks.command.mockImplementation(async (_command, args: string[]) => {
      if (args.includes("--download-sections")) throw new Error("ERROR: No space left on device");
      return { stdout: "", stderr: "" };
    });
    await expect(capture()).rejects.toThrow("Server storage is full");
    expect(downloads()).toHaveLength(1);
  });
});
