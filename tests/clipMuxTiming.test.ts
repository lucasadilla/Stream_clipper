import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "child_process";
import { mkdtemp, rm } from "fs/promises";
import os from "os";
import path from "path";
import {
  getFfmpegPath,
  getFfprobePath,
  hasAlignedClipStreams,
  muxAccurateClipSegment,
  probeMedia,
  runCommand,
} from "@/lib/ffmpeg";

const available = [getFfmpegPath(), getFfprobePath()].every(
  (binary) => spawnSync(binary, ["-version"], { windowsHide: true }).status === 0
);

describe.skipIf(!available)("companion-track cut timing", () => {
  let directory: string;
  let video: string;
  let audio: string;
  beforeAll(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "clipper-mux-timing-"));
    video = path.join(directory, "video.mp4");
    audio = path.join(directory, "audio.wav");
    // A 10-second GOP forces stream-copy cuts to retain an earlier keyframe.
    // Picture changes at 6 seconds; a matching audio tone starts at 6 seconds.
    await runCommand(getFfmpegPath(), [
      "-y", "-v", "error", "-f", "lavfi", "-i",
      "color=black:s=160x90:r=30:d=12,drawbox=color=white:t=fill:enable='gte(t,6)'",
      "-c:v", "libx264", "-g", "300", "-keyint_min", "300",
      "-sc_threshold", "0", "-pix_fmt", "yuv420p", video,
    ]);
    await runCommand(getFfmpegPath(), [
      "-y", "-v", "error", "-f", "lavfi", "-i",
      "aevalsrc=if(gte(t\\,6)\\,0.5*sin(2*PI*440*t)\\,0):s=48000:d=12", audio,
    ]);
  }, 30_000);
  afterAll(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("rejects an old keyframe-offset mux instead of reusing it", async () => {
    const output = path.join(directory, "old.mp4");
    await runCommand(getFfmpegPath(), [
      "-y", "-v", "error", "-ss", "6.2", "-i", video,
      "-ss", "6.2", "-i", audio, "-t", "3", "-map", "0:v:0",
      "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac",
      "-avoid_negative_ts", "make_zero", output,
    ]);
    expect(hasAlignedClipStreams(await probeMedia(output))).toBe(false);
  }, 30_000);

  it("starts picture and speech at the requested instant between keyframes", async () => {
    const output = path.join(directory, "accurate.mp4");
    await muxAccurateClipSegment(video, audio, output, 6.2, 3);
    const probe = await probeMedia(output);
    expect(hasAlignedClipStreams(probe)).toBe(true);
    expect(probe.durationSeconds).toBeCloseTo(3, 1);
    // Decode the first displayed pixel: the requested instant must be white.
    const picture = spawnSync(getFfmpegPath(), [
      "-v", "error", "-i", output, "-map", "0:v:0", "-frames:v", "1",
      "-vf", "scale=1:1", "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1",
    ], { windowsHide: true });
    expect(picture.status).toBe(0);
    expect(picture.stdout[0]).toBeGreaterThan(230);
    // Decode the first tenth of a second: speech/tone must already be present.
    const sound = spawnSync(getFfmpegPath(), [
      "-v", "error", "-i", output, "-map", "0:a:0", "-t", "0.1",
      "-ac", "1", "-ar", "48000", "-f", "s16le", "pipe:1",
    ], { windowsHide: true });
    expect(sound.status).toBe(0);
    let sumSquares = 0;
    for (let offset = 0; offset < sound.stdout.length - 1; offset += 2) {
      sumSquares += sound.stdout.readInt16LE(offset) ** 2;
    }
    expect(Math.sqrt(sumSquares / (sound.stdout.length / 2))).toBeGreaterThan(5000);
  }, 30_000);
});
