import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile, copyFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { getFfmpegPath, isFfmpegAvailable, probeMedia, renderShort, renderSequence, runCommand } from "@/lib/ffmpeg";
import { brandingVideoFilter } from "@/lib/social/channelPreset";
import { brandingFontFile } from "@/services/social/brandingFontService";

describe("channel branding in encoded files", () => {
  it("burns literal branding into vertical, native, and sequence exports without changing audio or native framing", async (context) => {
    if (!await isFfmpegAvailable()) { context.skip(); return; }
    const folder = await mkdtemp(path.join(tmpdir(), "clipper-branding-"));
    try {
      const source = path.join(folder, "source.mp4"), text = path.join(folder, "brand.txt");
      await writeFile(text, "@CLIPPER % ' :", "utf8");
      await runCommand(getFfmpegPath(), ["-y", "-nostdin", "-loglevel", "error", "-f", "lavfi", "-i", "color=black:size=640x360:rate=10", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "2", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", source], { timeoutMs: 20_000 });
      for (const format of ["vertical", "native", "sequence"] as const) {
        const output = path.join(folder, `${format}.mp4`), height = format === "native" ? 360 : 640;
        const filter = brandingVideoFilter(text, { text: "@CLIPPER % ' :", position: "top-left", color: "#FFFFFF" }, height, brandingFontFile());
        if (format === "sequence") await renderSequence({ inputPath: source, outputPath: output, format: "vertical", width: 360, height: 640, brandingFilter: filter,
          segments: [{ startTimeSeconds: 0, endTimeSeconds: 1, volume: 1, muted: false, fadeInSeconds: 0, fadeOutSeconds: 0 }] });
        else await renderShort({ inputPath: source, outputPath: output, startTimeSeconds: 0, endTimeSeconds: 1, format, layout: "center_crop", width: 360, height: 640, outputHeight: height, brandingFilter: filter });
        const probe = await probeMedia(output);
        expect(probe).toMatchObject({ videoCodec: "h264", audioCodec: "aac", width: format === "native" ? 640 : 360, height });
        expect(probe.durationSeconds).toBeCloseTo(1, 0);
        const pixels = path.join(folder, `${format}.gray`);
        await runCommand(getFfmpegPath(), ["-y", "-nostdin", "-loglevel", "error", "-ss", "0.2", "-i", output, "-frames:v", "1", "-pix_fmt", "gray", "-f", "rawvideo", pixels]);
        const bytes = await readFile(pixels);
        expect([...bytes].filter((value) => value > 100).length, `${format} export must contain visible branding`).toBeGreaterThan(40);
        if (format === "vertical" && process.env.CLIPPER_TEST_ARTIFACTS) {
          await mkdir(process.env.CLIPPER_TEST_ARTIFACTS, { recursive: true });
          await copyFile(output, path.join(process.env.CLIPPER_TEST_ARTIFACTS, "branding-smoke.mp4"));
          await runCommand(getFfmpegPath(), ["-y", "-loglevel", "error", "-ss", "0.2", "-i", output, "-frames:v", "1", path.join(process.env.CLIPPER_TEST_ARTIFACTS, "branding-smoke.png")]);
        }
      }
    } finally {
      const resolved = path.resolve(folder);
      if (resolved.startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(resolved).startsWith("clipper-branding-")) await rm(resolved, { recursive: true, force: true });
    }
  }, 60000);
});
