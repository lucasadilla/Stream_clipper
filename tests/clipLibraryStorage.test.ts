import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
const m = vi.hoisted(() => ({ root: "" }));
vi.mock("@/lib/storage", () => ({ getStorageRoot: () => m.root, resolveStoragePath: (value: string) => path.resolve(m.root, value), toRelativeStoragePath: (value: string) => path.relative(m.root, value) }));
import { assertOwnedLibraryFile, libraryAssetPath, libraryDirectory, preserveLibraryFile, removeLibraryFiles } from "@/lib/clipLibraryStorage";
beforeEach(async () => { m.root = await fs.mkdtemp(path.join(os.tmpdir(), "clip-library-files-")); });
afterEach(async () => { await fs.rm(m.root, { recursive: true, force: true }); });
describe("durable library files", () => {
  it("preserves exact bytes after the original workspace directory is removed", async () => {
    const workspace = path.join(m.root, "renders", "session"); await fs.mkdir(workspace, { recursive: true });
    const original = Buffer.from(Array.from({ length: 4096 }, (_, index) => index % 255));
    const source = path.join(workspace, "finished.mp4"); await fs.writeFile(source, original);
    const saved = libraryAssetPath("owner", "clip", "r_render");
    expect(await preserveLibraryFile(source, saved)).toBe(original.length);
    await fs.rm(workspace, { recursive: true });
    expect(await fs.readFile(saved)).toEqual(original);
    expect(await fs.readdir(path.dirname(saved))).toEqual(["r_render.mp4"]);
  });
  it("does not let path traversal select a deletion target or another owner's file", async () => {
    expect(() => libraryDirectory("../other", "clip")).toThrow();
    expect(() => libraryAssetPath("owner", "clip", "..\\secret")).toThrow();
    const file = libraryAssetPath("other", "clip", "r_render"); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, "private");
    await expect(assertOwnedLibraryFile(path.relative(m.root, file), "owner", "clip")).rejects.toThrow();
    expect((await fs.readFile(file)).toString()).toBe("private");
  });
  it("removes only the requested clip and is safe to retry", async () => {
    for (const id of ["one", "two"]) { const file = libraryAssetPath("owner", id, "r_video"); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, id); }
    await removeLibraryFiles("owner", "one"); await removeLibraryFiles("owner", "one");
    expect((await fs.readFile(libraryAssetPath("owner", "two", "r_video"))).toString()).toBe("two");
  });
  it("rejects a junction that redirects deletion into another clip", async () => {
    const other = libraryDirectory("other", "clip"); await fs.mkdir(other, { recursive: true }); await fs.writeFile(path.join(other, "keep"), "safe");
    const target = libraryDirectory("owner", "clip"); await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.symlink(other, target, process.platform === "win32" ? "junction" : "dir");
    await expect(removeLibraryFiles("owner", "clip")).rejects.toThrow("Invalid library deletion target");
    expect((await fs.readFile(path.join(other, "keep"))).toString()).toBe("safe");
  });
  it("never exposes an empty finished file as saved", async () => {
    const source = path.join(m.root, "empty.mp4"); await fs.writeFile(source, "");
    const target = libraryAssetPath("owner", "clip", "r_empty");
    await expect(preserveLibraryFile(source, target)).rejects.toThrow("missing or empty");
    await expect(fs.stat(target)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
