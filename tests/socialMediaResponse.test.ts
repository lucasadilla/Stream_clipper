import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import path from "path";
import { getStorageRoot } from "@/lib/storage";
import { socialMediaResponse } from "@/lib/social/mediaResponse";
let folder: string;
let file: string;
beforeAll(async () => {
  await mkdir(getStorageRoot(), { recursive: true });
  folder = await mkdtemp(path.join(getStorageRoot(), ".social-response-test-"));
  file = path.join(folder, "clip.mp4");
  await writeFile(file, Buffer.from("0123456789"));
});
afterAll(async () => { await rm(folder, { recursive: true, force: true }); });
describe("signed platform video transfer", () => {
  it("supports HEAD probes without transferring the video body", async () => {
    const response = await socialMediaResponse(file, new Request("https://clipper.example/media", { method: "HEAD" }));
    expect(response.status).toBe(200); expect(response.headers.get("Content-Length")).toBe("10");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.text()).toBe("");
  });
  it("streams only a bounded requested byte range", async () => {
    const response = await socialMediaResponse(file, new Request("https://clipper.example/media", { headers: { range: "bytes=3-99" } }));
    expect(response.status).toBe(206); expect(response.headers.get("Content-Range")).toBe("bytes 3-9/10");
    expect(response.headers.get("Content-Length")).toBe("7"); expect(await response.text()).toBe("3456789");
  });
  it("rejects impossible ranges and paths outside media storage", async () => {
    const response = await socialMediaResponse(file, new Request("https://clipper.example/media", { headers: { range: "bytes=15-20" } }));
    expect(response.status).toBe(416); expect(response.headers.get("Content-Range")).toBe("bytes */10");
    await expect(socialMediaResponse(path.resolve(getStorageRoot(), "../private.mp4"), new Request("https://clipper.example/media"))).rejects.toThrow(/invalid storage path/i);
  });
});
