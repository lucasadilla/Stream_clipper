import path from "path";
import { existsSync } from "fs";
import { getStorageRoot, getUploadDir, getRendersDir } from "@/lib/storage";
import { prisma } from "@/lib/db";
import { REPLACED_SESSION_STATUS } from "@/services/sessionCleanupService";

export function isNoSpaceError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code?: unknown }).code)
      : "";
  return (
    code === "ENOSPC" ||
    /no space left on device|enospc|disk.?full/i.test(message)
  );
}

export function noSpaceLeftError(): Error {
  return new Error(
    "Server storage is full. Delete old sessions from the Sessions list, or free space on the Railway volume, then try exporting again."
  );
}

/**
 * Best-effort reclaim of disposable media: failed ffmpeg temps, quarantine,
 * and media for sessions already marked replaced. Safe to call before mux/render.
 */
export async function reclaimEphemeralStorage(options?: {
  /** Prefer keeping this session's current media. */
  keepSessionId?: string;
  /** Also delete stale segment-* muxes for the keep session (except newest N). */
  pruneSessionSegments?: boolean;
}): Promise<{ freedBytes: number; removed: number }> {
  const fs = await import("fs/promises");
  const root = getStorageRoot();
  let freedBytes = 0;
  let removed = 0;

  async function unlinkFile(filePath: string): Promise<void> {
    try {
      const size = (await fs.stat(filePath)).size;
      await fs.unlink(filePath);
      freedBytes += size;
      removed += 1;
    } catch {
      // ignore busy/missing
    }
  }

  async function rmTree(dirPath: string): Promise<void> {
    if (!existsSync(dirPath)) return;
    try {
      const size = await directorySize(dirPath);
      await fs.rm(dirPath, { recursive: true, force: true });
      freedBytes += size;
      removed += 1;
    } catch {
      // ignore
    }
  }

  async function directorySize(dirPath: string): Promise<number> {
    let total = 0;
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dirPath, entry.name);
        if (entry.isDirectory()) total += await directorySize(full);
        else {
          try {
            total += (await fs.stat(full)).size;
          } catch {
            // skip
          }
        }
      }
    } catch {
      return 0;
    }
    return total;
  }

  // 1. Quarantine from failed deletes
  await rmTree(path.join(root, ".orphaned"));

  // 2. Temp files left by interrupted ffmpeg mux/encode
  for (const bucket of ["uploads", "renders", "frames", "audio"]) {
    const bucketDir = path.join(root, bucket);
    if (!existsSync(bucketDir)) continue;
    let sessionDirs: string[] = [];
    try {
      sessionDirs = await fs.readdir(bucketDir);
    } catch {
      continue;
    }
    for (const sessionId of sessionDirs) {
      const sessionDir = path.join(bucketDir, sessionId);
      await walkAndDeleteTemps(sessionDir, unlinkFile);
    }
  }

  // 3. Media for replaced sessions (DB row kept for billing; files can go)
  try {
    const replaced = await prisma.streamSession.findMany({
      where: {
        liveStatus: REPLACED_SESSION_STATUS,
        ...(options?.keepSessionId
          ? { id: { not: options.keepSessionId } }
          : {}),
      },
      select: { id: true },
      take: 25,
      orderBy: { updatedAt: "asc" },
    });
    for (const session of replaced) {
      await rmTree(getUploadDir(session.id));
      await rmTree(getRendersDir(session.id));
      await rmTree(path.join(root, "frames", session.id));
      await rmTree(path.join(root, "audio", session.id));
      await rmTree(path.join(root, "captions", session.id));
    }
  } catch (err) {
    console.warn("[storage] replaced-session reclaim skipped:", err);
  }

  // 4. Optional: drop older mux segments for the active session (keep newest 2)
  if (options?.pruneSessionSegments && options.keepSessionId) {
    const uploadDir = getUploadDir(options.keepSessionId);
    if (existsSync(uploadDir)) {
      try {
        const entries = await fs.readdir(uploadDir);
        const segments = entries
          .filter((name) => /^segment-\d+-\d+\.mp4$/i.test(name))
          .map((name) => ({
            name,
            full: path.join(uploadDir, name),
          }));
        const withMtime = await Promise.all(
          segments.map(async (s) => ({
            ...s,
            mtime: (await fs.stat(s.full).catch(() => null))?.mtimeMs ?? 0,
          }))
        );
        const stale = withMtime
          .sort((a, b) => b.mtime - a.mtime)
          .slice(2);
        for (const s of stale) {
          await unlinkFile(s.full);
        }
      } catch {
        // ignore
      }
    }
  }

  if (removed > 0) {
    console.info(
      `[storage] reclaimed ${removed} path(s), ~${Math.round(freedBytes / (1024 * 1024))} MB`
    );
  }

  return { freedBytes, removed };
}

async function walkAndDeleteTemps(
  dirPath: string,
  unlinkFile: (filePath: string) => Promise<void>
): Promise<void> {
  const fs = await import("fs/promises");
  if (!existsSync(dirPath)) return;
  let entries: import("fs").Dirent[];
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      await walkAndDeleteTemps(full, unlinkFile);
      continue;
    }
    const lower = entry.name.toLowerCase();
    if (
      lower.includes(".tmp.") ||
      lower.endsWith(".tmp") ||
      lower.endsWith(".tmp.mp4") ||
      /\.cut\.mp4$/i.test(lower) ||
      /\.memcap\.mp4$/i.test(lower)
    ) {
      await unlinkFile(full);
    }
  }
}
