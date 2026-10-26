import path from "path";
import { randomUUID } from "crypto";
import fs from "fs/promises";
import { constants } from "fs";
import { getStorageRoot, resolveStoragePath, toRelativeStoragePath } from "@/lib/storage";

function segment(value: string) {
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(value)) throw new Error("Invalid library identifier");
  return value;
}
export function libraryDirectory(accountId: string, itemId: string): string {
  const root = path.resolve(getStorageRoot(), "library");
  const target = path.resolve(root, segment(accountId), segment(itemId));
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Invalid library directory");
  return target;
}
export function libraryAssetPath(accountId: string, itemId: string, assetId: string, extension = "mp4"): string {
  if (!["mp4", "jpg"].includes(extension)) throw new Error("Invalid library file type");
  return path.join(libraryDirectory(accountId, itemId), `${segment(assetId)}.${extension}`);
}
export async function assertOwnedLibraryFile(relativePath: string, accountId: string, itemId: string): Promise<string> {
  const full = resolveStoragePath(relativePath);
  const [root, actual] = await Promise.all([fs.realpath(getStorageRoot()), fs.realpath(full)]);
  const expected = path.join(root, "library", segment(accountId), segment(itemId));
  const relative = path.relative(expected, actual);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Invalid saved video path");
  return full;
}
/** Copy bytes without encoding. Only a fully written and synced file becomes visible. */
export async function preserveLibraryFile(source: string, destination: string): Promise<number> {
  const original = await fs.stat(source);
  if (!original.isFile() || original.size === 0) throw new Error("Finished video is missing or empty");
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const existing = await fs.stat(destination).catch(() => null);
  if (existing?.isFile() && existing.size === original.size) return original.size;
  const temp = `${destination}.${randomUUID()}.partial`;
  try {
    await fs.copyFile(source, temp, constants.COPYFILE_FICLONE);
    const handle = await fs.open(temp, "r+");
    try { await handle.sync(); } finally { await handle.close(); }
    if ((await fs.stat(temp)).size !== original.size) throw new Error("Saved video copy is incomplete");
    await fs.rename(temp, destination);
    return original.size;
  } finally { await fs.unlink(temp).catch(() => undefined); }
}
export async function removeLibraryFiles(accountId: string, itemId: string): Promise<void> {
  const target = libraryDirectory(accountId, itemId);
  const entry = await fs.lstat(target).catch(error => { if (error.code === "ENOENT") return null; throw error; });
  if (!entry) return;
  const actual = await fs.realpath(target);
  const root = await fs.realpath(getStorageRoot());
  const expected = path.join(root, "library", segment(accountId), segment(itemId));
  if (entry.isSymbolicLink() || path.relative(expected, actual) !== "") throw new Error("Invalid library deletion target");
  await fs.rm(target, { recursive: true, force: true });
}
export { toRelativeStoragePath };
