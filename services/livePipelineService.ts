import { prisma } from "@/lib/db";
import { syncLiveRecording } from "@/services/liveRecordingService";
import { refreshSessionLiveMetadata } from "@/services/youtubeService";

function isLiveStatus(liveStatus: string | null | undefined): boolean {
  return (
    liveStatus === "live" ||
    liveStatus === "upcoming" ||
    liveStatus === "post_live"
  );
}

function canAutoStartRecording(
  recording: { status: string; lastSyncedAt: Date | null } | null
): boolean {
  if (!recording || recording.status === "idle" || recording.status === "stopped") {
    return true;
  }
  if (recording.status !== "failed") return false;
  return (
    !recording.lastSyncedAt ||
    Date.now() - recording.lastSyncedAt.getTime() >= 10 * 60 * 1000
  );
}

/**
 * One live tick: sync recording and metadata.
 * Filmstrip thumbs are owned by GET /timeline-thumbs (client poll).
 */
export async function runLivePipeline(streamSessionId: string) {
  const results: Record<string, unknown> = {};

  const fresh = await prisma.streamSession.findUnique({
    where: { id: streamSessionId },
    include: { liveRecording: true },
  });
  if (!fresh) throw new Error("Session not found");

  const skipThumbs = fresh.mode === "agent";

  try {
    if (isLiveStatus(fresh.liveStatus)) {
      results.metadata = await refreshSessionLiveMetadata(streamSessionId);
      if (results.metadata && typeof results.metadata === "object") {
        const m = results.metadata as {
          liveStatus?: string | null;
          title?: string | null;
          concurrentViewers?: number | null;
        };
        results.metadata = {
          liveStatus: m.liveStatus,
          title: m.title,
          concurrentViewers: m.concurrentViewers,
        };
      }
    }
  } catch (e) {
    results.metadataError = e instanceof Error ? e.message : String(e);
  }

  if (
    fresh.liveRecording?.status === "recording" ||
    fresh.liveStatus === "live" ||
    fresh.liveStatus === "upcoming"
  ) {
    const syncedBeforeStart =
      fresh.liveRecording?.status === "recording"
        ? await syncLiveRecording(streamSessionId)
        : null;
    const recoveredStaleRecording = syncedBeforeStart?.status === "failed";
    if (
      (fresh.liveRecording?.status !== "recording" || recoveredStaleRecording) &&
      (recoveredStaleRecording || canAutoStartRecording(fresh.liveRecording))
    ) {
      try {
        const { acquireSourceMedia } = await import(
          "@/services/liveRecordingService"
        );
        results.recordingStart = await acquireSourceMedia(streamSessionId);
      } catch (e) {
        results.recordingStartError =
          e instanceof Error ? e.message : String(e);
      }
    }
    results.recording =
      results.recordingStart ??
      syncedBeforeStart ??
      (await syncLiveRecording(streamSessionId));
  }

  if (skipThumbs) {
    results.thumbnailsSkipped = "agent_mode";
  }

  return results;
}
