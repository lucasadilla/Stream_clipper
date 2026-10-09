import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";

const mocks = vi.hoisted(() => ({
  directory: "",
  download: vi.fn(),
  decode: vi.fn(),
  session: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: {
  streamSession: { findUnique: mocks.session },
  sourceMedia: {
    findMany: vi.fn(async () => []),
    findFirst: vi.fn(async () => null),
    create: vi.fn(async ({ data }) => ({ ...data,
      id: data.originalFilename.startsWith("render-source-") ? "recovered" : "main",
    })),
  },
} }));
vi.mock("@/lib/storage", () => ({
  getUploadDir: () => mocks.directory,
  ensureDir: (directory: string) => mkdir(directory, { recursive: true }),
  toRelativeStoragePath: (file: string) => file,
  resolveStoragePath: (file: string) => file,
  fileExists: () => false,
  findBestSourceFileInDir: async () => path.join(mocks.directory, "source.f135.mp4"),
  listSourceCandidateFiles: async () => [
    path.join(mocks.directory, "source.f135.mp4"),
    path.join(mocks.directory, "source.audio.m4a"),
  ],
}));
vi.mock("@/services/previewVideoService", () => ({
  getPreviewMp4Path: () => path.join(mocks.directory, "preview.mp4"),
}));
vi.mock("@/services/storageReclaimService", () => ({
  isNoSpaceError: () => false,
  noSpaceLeftError: () => new Error("Disk full"),
  reclaimEphemeralStorage: vi.fn(),
}));
vi.mock("@/services/youtubeDownloadService", () => ({
  acceptableFinalSourceHeight: () => 1080,
  minFinalSourceHeight: () => 720,
  renderSourceMaxHeight: () => 1080,
  isYtDlpAvailable: async () => true,
  resolveStreamCaptureUrl: (session: { youtubeUrl: string }) => session.youtubeUrl,
  classifyYtDlpError: () => "unknown",
  formatYtDlpUserError: () => "Capture could not finish. Retry capture.",
  downloadClipSegmentFromStream: mocks.download,
}));
vi.mock("@/lib/ffmpeg", () => ({
  canDecodeVideoFrame: mocks.decode,
  hasVideoStream: async () => true,
  hasAudioStream: async (file: string) => !file.endsWith("source.f135.mp4"),
  hasAlignedClipStreams: () => true,
  muxAccurateClipSegment: async (_video: string, _audio: string, output: string) => {
    await writeFile(output, "audio only because the video range is missing");
  },
  probeMedia: async (file: string) => ({
    durationSeconds: file.includes("render-source-") ? 27 :
      file.includes("segment-") ? 23 : 7200,
    width: 1920, height: 1080, fps: 30,
    videoCodec: file.includes("segment-") || file.endsWith("source.audio.m4a") ? null : "h264",
    audioCodec: file.endsWith("source.f135.mp4") ? null : "aac",
    raw: {},
  }),
}));

import { ensureClipSourceForRender } from "@/services/clipSourceService";

describe("incomplete companion-track recovery", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.directory = await mkdtemp(path.join(os.tmpdir(), "clipper-source-recovery-"));
    await writeFile(path.join(mocks.directory, "source.f135.mp4"), "incomplete video");
    await writeFile(path.join(mocks.directory, "source.audio.m4a"), "complete audio");
    mocks.session.mockResolvedValue({ id: "session", platform: "youtube", liveStatus: "ended",
      youtubeVideoId: "video", youtubeUrl: "https://www.youtube.com/watch?v=video", liveRecording: null });
    mocks.decode.mockImplementation(async (_file: string, time = 1) => time < 100);
    mocks.download.mockImplementation(async (_url, _start, _end, output) => {
      await writeFile(output, "recovered video and audio");
    });
  });
  afterEach(async () => {
    await rm(mocks.directory, { recursive: true, force: true });
  });

  it("recovers only the requested range and shares simultaneous recovery requests", async () => {
    const request = () => ensureClipSourceForRender("session", 3436.43, 3458.22, undefined, { purpose: "preview" });
    const results = await Promise.all([request(), request()]);
    expect(results).toEqual([
      { sourceMediaId: "recovered", renderStart: expect.closeTo(2.43, 2), renderEnd: expect.closeTo(24.22, 2) },
      { sourceMediaId: "recovered", renderStart: expect.closeTo(2.43, 2), renderEnd: expect.closeTo(24.22, 2) },
    ]);
    expect(mocks.download).toHaveBeenCalledTimes(1);
    expect(mocks.download.mock.calls[0].slice(0, 3)).toEqual([
      "https://www.youtube.com/watch?v=video", "57:14", "57:41",
    ]);
    expect(mocks.decode).toHaveBeenCalled();
  });

  it("reports failed recovery without claiming storage is full", async () => {
    mocks.download.mockRejectedValueOnce(new Error("capture failed"));
    await expect(ensureClipSourceForRender("session", 3436.43, 3458.22, undefined, { purpose: "preview" }))
      .rejects.toThrow("Could not recover the source video for this clip. Capture could not finish. Retry capture.");
  });
});
