import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { afterAll, describe, expect, it } from "vitest";
import { generateAss } from "@/lib/captionAss";
import { DEFAULT_CAPTION_APPEARANCE } from "@/lib/captionAppearance";
import { getFfmpegPath } from "@/lib/ffmpeg";

const enabled = process.env.CLIPPER_FFMPEG_INTEGRATION === "1";
const workDir = path.join(process.cwd(), "work", "speaker-caption-render-test");

describe.runIf(enabled)("speaker caption FFmpeg integration", () => {
  afterAll(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it("burns different speaker colors into the actual video frames", () => {
    fs.mkdirSync(workDir, { recursive: true });
    const assPath = path.join(workDir, "speakers.ass");
    const outputPath = path.join(workDir, "speakers.mp4");
    fs.writeFileSync(
      assPath,
      generateAss({
        width: 640,
        height: 360,
        syncMode: "precise",
        appearance: {
          ...DEFAULT_CAPTION_APPEARANCE,
          vertical: "center",
          fontSize: 96,
          fontWeight: "bold",
          animation: "none",
          karaokeEnabled: false,
          shadow: 0,
          outlineWidth: 0,
        },
        cues: [
          {
            startTimeSeconds: 0,
            endTimeSeconds: 1,
            text: "SPEAKER COLOR",
            speakerId: "speaker-red",
            speakerConfidence: 1,
            speakerColor: "#FF3030",
          },
          {
            startTimeSeconds: 1,
            endTimeSeconds: 2,
            text: "SPEAKER COLOR",
            speakerId: "speaker-green",
            speakerConfidence: 1,
            speakerColor: "#30FF30",
          },
        ],
      }),
      "utf8"
    );

    const relativeAss = path.relative(process.cwd(), assPath).replace(/\\/g, "/");
    const render = spawnSync(
      getFfmpegPath(),
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=640x360:d=2:r=30",
        "-vf",
        `subtitles=${relativeAss}`,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        outputPath,
      ],
      { encoding: "utf8" }
    );
    expect(render.status, render.stderr).toBe(0);
    expect(fs.statSync(outputPath).size).toBeGreaterThan(1_000);

    const sampleV = (time: number) => {
      const sample = spawnSync(
        getFfmpegPath(),
        [
          "-v",
          "info",
          "-ss",
          String(time),
          "-i",
          outputPath,
          "-vf",
          "crop=560:180:40:90,signalstats,metadata=print",
          "-frames:v",
          "1",
          "-f",
          "null",
          "-",
        ],
        { encoding: "utf8" }
      );
      expect(sample.status, sample.stderr).toBe(0);
      const match = `${sample.stdout}\n${sample.stderr}`.match(
        /lavfi\.signalstats\.VAVG=([0-9.]+)/
      );
      expect(match).toBeTruthy();
      return Number(match![1]);
    };

    // Red has materially higher V chroma than green. This checks encoded
    // pixels, rather than only checking the ASS plan.
    expect(sampleV(0.5)).toBeGreaterThan(sampleV(1.5) + 2);
  }, 30_000);
});
