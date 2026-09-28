import { prisma } from "@/lib/db";
import { fileExists } from "@/lib/storage";

// The transcription API has a five-minute execution ceiling. A lock older
// than six minutes cannot belong to a healthy request and must not strand a session.
const DEFAULT_STALE_MS = 6 * 60 * 1000;
const INTERACTIVE_PREEMPT_MS = 15_000;

function staleMs(): number {
  return Math.max(
    60_000,
    Number.parseInt(process.env.WORKER_STALE_MS || String(DEFAULT_STALE_MS), 10) ||
      DEFAULT_STALE_MS
  );
}

export function canPreemptTranscriptionLock(input: {
  requester: string;
  holder: string | null;
  lockedAt: Date | null;
  now?: Date;
}): boolean {
  if (
    !input.requester.startsWith("api-") ||
    !input.holder?.startsWith("worker-") ||
    !input.lockedAt
  ) {
    return false;
  }
  const now = input.now ?? new Date();
  return now.getTime() - input.lockedAt.getTime() >= INTERACTIVE_PREEMPT_MS;
}

/** Claim a DB-backed transcription lock for a session. */
export async function claimTranscriptionLock(
  streamSessionId: string,
  workerId: string
): Promise<boolean> {
  const cutoff = new Date(Date.now() - staleMs());
  const session = await prisma.streamSession.findUnique({
    where: { id: streamSessionId },
    select: { transcribeLockedAt: true, transcribeLockedBy: true },
  });
  if (!session) return false;

  const preemptBackground = canPreemptTranscriptionLock({
    requester: workerId,
    holder: session.transcribeLockedBy,
    lockedAt: session.transcribeLockedAt,
  });

  const locked =
    session.transcribeLockedAt &&
    session.transcribeLockedAt > cutoff &&
    session.transcribeLockedBy &&
    session.transcribeLockedBy !== workerId &&
    !preemptBackground;
  if (locked) return false;

  const updated = await prisma.streamSession.updateMany({
    where: {
      id: streamSessionId,
      OR: [
        { transcribeLockedAt: null },
        { transcribeLockedAt: { lt: cutoff } },
        { transcribeLockedBy: workerId },
        ...(preemptBackground
          ? [
              {
                transcribeLockedBy: { startsWith: "worker-" },
                transcribeLockedAt: {
                  lt: new Date(Date.now() - INTERACTIVE_PREEMPT_MS),
                },
              },
            ]
          : []),
      ],
    },
    data: {
      transcribeLockedAt: new Date(),
      transcribeLockedBy: workerId,
    },
  });
  return updated.count === 1;
}

export async function releaseTranscriptionLock(
  streamSessionId: string,
  workerId: string
): Promise<void> {
  await prisma.streamSession.updateMany({
    where: { id: streamSessionId, transcribeLockedBy: workerId },
    data: { transcribeLockedAt: null, transcribeLockedBy: null },
  });
}

/**
 * Sessions that likely need transcription work: have source media and either
 * no recent lock or unfinished coverage (heuristic via live recording / media).
 */
export async function listSessionsNeedingTranscription(
  limit = 6
): Promise<string[]> {
  const cutoff = new Date(Date.now() - staleMs());
  const sessions = await prisma.streamSession.findMany({
    where: {
      sourceMedia: { some: {} },
      NOT: { liveStatus: "replaced" },
      OR: [
        { transcribeLockedAt: null },
        { transcribeLockedAt: { lt: cutoff } },
      ],
    },
    // Interactive agent sessions should not sit behind background timeline work.
    orderBy: [{ mode: "asc" }, { updatedAt: "desc" }],
    take: limit * 3,
    select: {
      id: true,
      liveRecording: { select: { recordedSeconds: true, status: true } },
      sourceMedia: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { durationSeconds: true, filePath: true },
      },
      transcriptChunks: {
        where: {
          OR: [
            { text: { not: "" } },
          ],
        },
        orderBy: { endTimeSeconds: "desc" },
        take: 1,
        select: { endTimeSeconds: true },
      },
    },
  });

  const needing: string[] = [];
  for (const session of sessions) {
    // Background workers may share a database while using different disks.
    // Never lock a session whose media is not present on this worker.
    if (!fileExists(session.sourceMedia[0]?.filePath)) continue;
    const recorded = Math.max(
      session.liveRecording?.recordedSeconds ?? 0,
      session.sourceMedia[0]?.durationSeconds ?? 0
    );
    if (recorded < 3) continue;
    const transcribedThrough = session.transcriptChunks[0]?.endTimeSeconds ?? 0;
    if (transcribedThrough + 2 < recorded) {
      needing.push(session.id);
    }
    if (needing.length >= limit) break;
  }
  return needing;
}
