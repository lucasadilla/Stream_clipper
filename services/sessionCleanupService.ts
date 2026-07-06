import { prisma } from "@/lib/db";
import {
  deleteSessionStorage,
  formatBytes,
  getSessionStorageBytes,
} from "@/lib/storage";
import { stopLiveRecording } from "@/services/liveRecordingService";
import {
  clearSessionTranscriptionState,
  waitForTranscriptionIdle,
} from "@/services/transcriptionSyncService";

export interface SessionDeleteResult {
  freedBytes: number;
  storageLabel: string;
  fullyRemoved: boolean;
  orphanedPaths: string[];
}

async function prepareSessionForDeletion(streamSessionId: string) {
  try {
    const session = await prisma.streamSession.findUnique({
      where: { id: streamSessionId },
      include: { liveRecording: true },
    });
    if (!session) return;

    if (
      session.liveRecording?.status === "recording" ||
      session.liveRecording?.pid
    ) {
      await stopLiveRecording(streamSessionId, { skipSync: true });
    }

    clearSessionTranscriptionState(streamSessionId);
    await waitForTranscriptionIdle(streamSessionId, 3000);
    await new Promise((r) => setTimeout(r, 400));
  } catch (err) {
    console.warn("[delete] prepare failed, continuing:", err);
  }
}

export interface SessionStorageInfo {
  sessionId: string;
  title: string | null;
  platform: string;
  youtubeVideoId: string;
  liveStatus: string | null;
  createdAt: Date;
  storageBytes: number;
  storageLabel: string;
}

export async function getSessionStorageInfo(
  streamSessionId: string
): Promise<SessionStorageInfo | null> {
  const session = await prisma.streamSession.findUnique({
    where: { id: streamSessionId },
    select: {
      id: true,
      title: true,
      platform: true,
      youtubeVideoId: true,
      liveStatus: true,
      createdAt: true,
    },
  });
  if (!session) return null;

  const storageBytes = await getSessionStorageBytes(streamSessionId);
  return {
    sessionId: session.id,
    title: session.title,
    platform: session.platform ?? "youtube",
    youtubeVideoId: session.youtubeVideoId,
    liveStatus: session.liveStatus,
    createdAt: session.createdAt,
    storageBytes,
    storageLabel: formatBytes(storageBytes),
  };
}

export async function listSessionsWithStorage(limit = 20): Promise<SessionStorageInfo[]> {
  const sessions = await prisma.streamSession.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      title: true,
      platform: true,
      youtubeVideoId: true,
      liveStatus: true,
      createdAt: true,
    },
  });

  const results: SessionStorageInfo[] = [];
  for (const session of sessions) {
    const storageBytes = await getSessionStorageBytes(session.id);
    results.push({
      sessionId: session.id,
      title: session.title,
      platform: session.platform ?? "youtube",
      youtubeVideoId: session.youtubeVideoId,
      liveStatus: session.liveStatus,
      createdAt: session.createdAt,
      storageBytes,
      storageLabel: formatBytes(storageBytes),
    });
  }
  return results;
}

/** Stop recording and delete all files for a session (DB rows remain). */
export async function clearSessionStorage(
  streamSessionId: string
): Promise<SessionDeleteResult> {
  const exists = await prisma.streamSession.findUnique({
    where: { id: streamSessionId },
    select: { id: true },
  });
  if (!exists) throw new Error("Session not found");

  await prepareSessionForDeletion(streamSessionId);
  const storage = await deleteSessionStorage(streamSessionId);

  return {
    freedBytes: storage.freedBytes,
    storageLabel: formatBytes(storage.freedBytes),
    fullyRemoved: storage.fullyRemoved,
    orphanedPaths: storage.orphanedPaths,
  };
}

/**
 * Remove session from DB always. Files are best-effort; locked folders are
 * quarantined under storage/.orphaned/ instead of blocking delete.
 */
export async function deleteStreamSession(
  streamSessionId: string
): Promise<SessionDeleteResult> {
  const session = await prisma.streamSession.findUnique({
    where: { id: streamSessionId },
    select: { id: true },
  });
  if (!session) throw new Error("Session not found");

  await prepareSessionForDeletion(streamSessionId);

  const storage = await deleteSessionStorage(streamSessionId);

  await prisma.streamSession.delete({ where: { id: streamSessionId } });

  return {
    freedBytes: storage.freedBytes,
    storageLabel: formatBytes(storage.freedBytes),
    fullyRemoved: storage.fullyRemoved,
    orphanedPaths: storage.orphanedPaths,
  };
}
