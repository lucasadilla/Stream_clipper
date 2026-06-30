import { prisma } from "@/lib/db";
import {
  deleteSessionStorage,
  getSessionStorageBytes,
  formatBytes,
} from "@/lib/storage";
import { stopLiveRecording } from "@/services/liveRecordingService";

export interface SessionStorageInfo {
  sessionId: string;
  title: string | null;
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
export async function clearSessionStorage(streamSessionId: string) {
  const session = await prisma.streamSession.findUnique({
    where: { id: streamSessionId },
    include: { liveRecording: true },
  });
  if (!session) throw new Error("Session not found");

  if (session.liveRecording?.status === "recording") {
    await stopLiveRecording(streamSessionId);
  }

  const freedBytes = await getSessionStorageBytes(streamSessionId);
  await deleteSessionStorage(streamSessionId);

  return { freedBytes, storageLabel: formatBytes(freedBytes) };
}

/** Stop recording, delete files, and remove the session from the database. */
export async function deleteStreamSession(streamSessionId: string) {
  const session = await prisma.streamSession.findUnique({
    where: { id: streamSessionId },
    include: { liveRecording: true },
  });
  if (!session) throw new Error("Session not found");

  if (session.liveRecording?.status === "recording") {
    await stopLiveRecording(streamSessionId);
  }

  const freedBytes = await getSessionStorageBytes(streamSessionId);
  await deleteSessionStorage(streamSessionId);
  await prisma.streamSession.delete({ where: { id: streamSessionId } });

  return { freedBytes, storageLabel: formatBytes(freedBytes) };
}
