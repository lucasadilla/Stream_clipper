import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadSourceInWorkspace } from "@/lib/sourceDownloadWorkspace";
import { isYtDlpTempFile } from "@/lib/storage";

describe("source download staging", () => {
  let destinationDir: string;
  beforeEach(async () => {
    destinationDir = await fs.mkdtemp(path.join(os.tmpdir(), "source-workspace-test-"));
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(destinationDir, { recursive: true, force: true });
  });

  it("publishes only the finished merge and leaves no duplicate tracks on the media volume", async () => {
    const destination = path.join(destinationDir, "source.mp4");
    let scratchDir = "";
    await downloadSourceInWorkspace(destination, async (staged) => {
      scratchDir = path.dirname(staged);
      expect(scratchDir).not.toBe(destinationDir);
      await fs.writeFile(path.join(scratchDir, "source.f135.mp4"), "video track");
      await fs.writeFile(path.join(scratchDir, "source.f140.m4a"), "audio track");
      expect(await fs.readdir(destinationDir)).toEqual([]);
      await fs.writeFile(staged, "combined video and audio");
    });
    expect(await fs.readFile(destination, "utf8")).toBe("combined video and audio");
    expect(await fs.readdir(destinationDir)).toEqual(["source.mp4"]);
    await expect(fs.access(scratchDir)).rejects.toThrow();
  });

  it("cleans failed downloads without replacing an existing source", async () => {
    const destination = path.join(destinationDir, "source.mp4");
    await fs.writeFile(destination, "existing source");
    let scratchDir = "";
    await expect(downloadSourceInWorkspace(destination, async (staged) => {
      scratchDir = path.dirname(staged);
      await fs.writeFile(staged, "partial source");
      throw new Error("capture timed out");
    })).rejects.toThrow("capture timed out");
    expect(await fs.readFile(destination, "utf8")).toBe("existing source");
    await expect(fs.access(scratchDir)).rejects.toThrow();
  });

  it("rejects insufficient persistent storage before copying a large merge", async () => {
    vi.spyOn(fs, "statfs").mockResolvedValue({ bavail: 1, bsize: 4096 } as Awaited<ReturnType<typeof fs.statfs>>);
    const copy = vi.spyOn(fs, "copyFile");
    await expect(downloadSourceInWorkspace(path.join(destinationDir, "source.mp4"), async (staged) => {
      await fs.writeFile(staged, "finished source");
    })).rejects.toThrow("Server storage is full");
    expect(copy).not.toHaveBeenCalled();
    expect(await fs.readdir(destinationDir)).toEqual([]);
  });

  it("removes incomplete promotion files when storage fills during the copy", async () => {
    vi.spyOn(fs, "copyFile").mockImplementation(async (_source, pending) => {
      expect(isYtDlpTempFile(path.basename(String(pending)))).toBe(true);
      await fs.writeFile(pending, "incomplete");
      throw Object.assign(new Error("write failed"), { code: "ENOSPC" });
    });
    await expect(downloadSourceInWorkspace(path.join(destinationDir, "source.mp4"), async (staged) => {
      await fs.writeFile(staged, "finished source");
    })).rejects.toThrow("Server storage is full");
    expect(await fs.readdir(destinationDir)).toEqual([]);
  });
});
