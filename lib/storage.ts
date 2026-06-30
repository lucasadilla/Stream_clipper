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

export function getSessionStorageDirs(sessionId: string): string[] {
  return [
    getUploadDir(sessionId),
    getFramesDir(sessionId),
    getRendersDir(sessionId),
  ];
}

export async function getDirectorySizeBytes(dirPath: string): Promise<number> {
  const fs = await import("fs/promises");
  if (!existsSync(dirPath)) return 0;

  let total = 0;
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      total += await getDirectorySizeBytes(full);
    } else {
      try {
        total += (await fs.stat(full)).size;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== "ENOENT") throw err;
      }
    }
  }
  return total;
}

export async function getSessionStorageBytes(sessionId: string): Promise<number> {
  let total = 0;
  for (const dir of getSessionStorageDirs(sessionId)) {
    total += await getDirectorySizeBytes(dir);
  }
  return total;
}

/** Remove all on-disk files for a session (uploads, frames, renders). */
export async function deleteSessionStorage(sessionId: string): Promise<void> {
  const fs = await import("fs/promises");
  for (const dir of getSessionStorageDirs(sessionId)) {
    if (existsSync(dir)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

/** yt-dlp partial / HLS fragment files — not stable recording outputs */
export function isYtDlpTempFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  return (
    lower.endsWith(".part") ||
    lower.endsWith(".ytdl") ||
    lower.includes("-frag") ||
    lower.endsWith(".tmp") ||
    lower.endsWith(".temp")
  );
}

export function isMergedSourceFile(filename: string): boolean {
  return /^source\.(mkv|mp4|webm|mov)$/i.test(filename);
}

async function safeStatSize(filePath: string): Promise<number | null> {
  const fs = await import("fs/promises");
  try {
    return (await fs.stat(filePath)).size;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    throw err;
  }
}

/**
 * Pick the best yt-dlp output file in a session upload folder.
 * Ignores HLS fragments and tolerates files disappearing during live capture.
 */
export async function findBestSourceFileInDir(
  uploadDir: string
): Promise<string | null> {
  const fs = await import("fs/promises");
  if (!existsSync(uploadDir)) return null;

  const files = await fs.readdir(uploadDir);
  const candidates = files.filter(
    (f) => f.startsWith("source.") && !isYtDlpTempFile(f)
  );
  if (candidates.length === 0) return null;

  const merged = candidates.filter(isMergedSourceFile);
  const pool =
    merged.length > 0
      ? merged
      : candidates.filter((f) => !/\.f\d+\./i.test(f));

  const searchPool = pool.length > 0 ? pool : candidates;

  let bestPath: string | null = null;
  let bestSize = 0;

  for (const name of searchPool) {
    const full = path.join(uploadDir, name);
    const size = await safeStatSize(full);
    if (size == null) continue;
    if (size > bestSize) {
      bestSize = size;
      bestPath = full;
    }
  }

  return bestPath;
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
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  return "application/octet-stream";
}

/** Serve a file for inline display (images, video preview). */
export async function serveStorageFileInline(
  relativePath: string
): Promise<Response> {
  const fullPath = resolveStoragePath(relativePath);
  if (!existsSync(fullPath)) {
    return new Response("File not found", { status: 404 });
  }

  const data = await readFileFs(fullPath);
  return new Response(new Uint8Array(data), {
    status: 200,
    headers: {
      "Content-Type": contentTypeForFile(fullPath),
      "Content-Length": String(data.byteLength),
      "Cache-Control": "public, max-age=3600",
    },
  });
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
