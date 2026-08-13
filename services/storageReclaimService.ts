import path from "path";
import { existsSync } from "fs";
import {
  getStorageRoot,
  getUploadDir,
  getRendersDir,
  isMergedSourceFile,
  isYtDlpSplitSourceFile,
  isYtDlpTempFile,
} from "@/lib/storage";
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
    "Server storage is full. Automatic cleanup is running; wait a moment and try again. If it stays full, verify the Railway volume mount and capacity."
  );
}

/**
 * Best-effort reclaim of disposable media: orphaned session directories,
 * failed-process temps, redundant download tracks, and replaced-session media.
 * Safe to call before mux/render.
 */
export async function reclaimEphemeralStorage(options?: {
  /** Prefer keeping this session's current media. */
  keepSessionId?: string;
  /** Also delete stale segment-* muxes for the keep session (except newest N). */
  pruneSessionSegments?: boolean;
}): Promise<{ freedBytes: number; removed: number }> {
  const fs = await import("fs/promises");
  const root = getStorageRoot();
  const tempCutoff = Date.now() - 15 * 60 * 1000;
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

  const sessions = await prisma.streamSession.findMany({
    select: {
      id: true,
      liveStatus: true,
      liveRecording: { select: { status: true } },
      sourceMedia: { select: { filePath: true } },
    },
  });
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));

  // 2. Remove DB-orphaned directories and stale interrupted media files.
  for (const bucket of ["uploads", "renders", "frames", "audio", "captions"]) {
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
      const stat = await fs.stat(sessionDir).catch(() => null);
      if (!stat?.isDirectory()) continue;
      const session = sessionsById.get(sessionId);
      if (!session || session.liveStatus === REPLACED_SESSION_STATUS) {
        await rmTree(sessionDir);
        continue;
      }
      await walkAndDeleteTemps(sessionDir, unlinkFile, tempCutoff);
      if (
        bucket === "uploads" &&
        session.liveRecording?.status !== "recording"
      ) {
        await pruneRedundantSourceTracks(
          sessionDir,
          session.sourceMedia.map((media) => media.filePath),
          unlinkFile,
          tempCutoff
        );
      }
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

async function pruneRedundantSourceTracks(
  uploadDir: string,
  referencedPaths: string[],
  unlinkFile: (filePath: string) => Promise<void>,
  cutoffMs: number
): Promise<void> {
  const fs = await import("fs/promises");
  const referencedNames = new Set(
    referencedPaths.map((filePath) => path.basename(filePath).toLowerCase())
  );
  const hasFinalSource = [...referencedNames].some(
    (name) => isMergedSourceFile(name) && existsSync(path.join(uploadDir, name))
  );
  // Keep format tracks until a stable audio sidecar exists. A merged DASH file
  // can be video-only, and transcription must never lose its only audio source.
  if (!hasFinalSource || !existsSync(path.join(uploadDir, "source.audio.m4a"))) {
    return;
  }

  let entries: import("fs").Dirent[];
  try {
    entries = await fs.readdir(uploadDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const lower = entry.name.toLowerCase();
    if (
      !entry.isFile() ||
      referencedNames.has(lower) ||
      !isYtDlpSplitSourceFile(lower)
    ) {
      continue;
    }
    const full = path.join(uploadDir, entry.name);
    const mtime = (await fs.stat(full).catch(() => null))?.mtimeMs;
    if (mtime != null && mtime < cutoffMs) await unlinkFile(full);
  }
}

async function walkAndDeleteTemps(
  dirPath: string,
  unlinkFile: (filePath: string) => Promise<void>,
  cutoffMs: number
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
      await walkAndDeleteTemps(full, unlinkFile, cutoffMs);
      continue;
    }
    const lower = entry.name.toLowerCase();
    const mtime = (await fs.stat(full).catch(() => null))?.mtimeMs;
    if (
      mtime != null &&
      mtime < cutoffMs &&
      (isYtDlpTempFile(lower) ||
        /\.cut\.mp4$/i.test(lower) ||
        /\.memcap\.mp4$/i.test(lower) ||
        /\.locked-\d+$/i.test(lower))
    ) {
      await unlinkFile(full);
    }
  }
}
