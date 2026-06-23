import path from "path";
import { existsSync } from "fs";
import { readFile as readFileFs } from "fs/promises";

const STORAGE_ROOT = process.env.STORAGE_ROOT ?? "./storage";

export function getStorageRoot(): string {
  return path.resolve(process.cwd(), STORAGE_ROOT);
}

export function getUploadDir(sessionId: string): string {
  return path.join(getStorageRoot(), "uploads", sessionId);
}

export function getFramesDir(sessionId: string): string {
  return path.join(getStorageRoot(), "frames", sessionId);
}

export function getRendersDir(sessionId: string): string {
  return path.join(getStorageRoot(), "renders", sessionId);
}

export async function ensureDir(dirPath: string): Promise<void> {
  const fs = await import("fs/promises");
  await fs.mkdir(dirPath, { recursive: true });
}

export async function ensureStorageDirs(): Promise<void> {
  const root = getStorageRoot();
  await ensureDir(path.join(root, "uploads"));
  await ensureDir(path.join(root, "frames"));
  await ensureDir(path.join(root, "renders"));
}

export function resolveStoragePath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/");
  const full = path.resolve(getStorageRoot(), normalized);
  const root = getStorageRoot();
  const rel = path.relative(root, full);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Invalid storage path");
  }
  return full;
}

export async function writeFile(
  relativePath: string,
  data: Buffer | string
): Promise<string> {
  const fullPath = resolveStoragePath(relativePath);
  await ensureDir(path.dirname(fullPath));
  const fs = await import("fs/promises");
  await fs.writeFile(fullPath, data);
  return fullPath;
}

export async function readFile(relativePath: string): Promise<Buffer> {
  const fullPath = resolveStoragePath(relativePath);
  return readFileFs(fullPath);
}

export function fileExists(relativePath: string): boolean {
  try {
    return existsSync(resolveStoragePath(relativePath));
  } catch {
    return false;
  }
}

/** Relative path from storage root for DB persistence */
export function toRelativeStoragePath(absolutePath: string): string {
  const root = getStorageRoot();
  return path.relative(root, absolutePath).replace(/\\/g, "/");
}

function contentTypeForFile(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".webm") return "video/webm";
  if (ext === ".mkv") return "video/x-matroska";
  if (ext === ".srt") return "text/plain";
  return "application/octet-stream";
}

/** Stream a file from storage with forced-download headers. */
export async function serveStorageFile(
  relativePath: string,
  downloadFilename?: string
): Promise<Response> {
  const fullPath = resolveStoragePath(relativePath);
  if (!existsSync(fullPath)) {
    return new Response("File not found", { status: 404 });
  }

  const data = await readFileFs(fullPath);
  const filename = (downloadFilename ?? path.basename(fullPath)).replace(
    /[^\w.\-() ]/g,
    "_"
  );

  return new Response(new Uint8Array(data), {
    status: 200,
    headers: {
      "Content-Type": contentTypeForFile(fullPath),
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(data.byteLength),
      "Cache-Control": "private, no-cache",
    },
  });
}

export const ALLOWED_VIDEO_EXTENSIONS = [".mp4", ".mov", ".webm", ".mkv"];
export const ALLOWED_VIDEO_MIMES = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-matroska",
];

export function isAllowedVideoFile(filename: string, mimeType: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return (
    ALLOWED_VIDEO_EXTENSIONS.includes(ext) ||
    ALLOWED_VIDEO_MIMES.includes(mimeType)
  );
}
