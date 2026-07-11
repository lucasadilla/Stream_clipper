import { prisma } from "@/lib/db";
import { syncLiveRecording } from "@/services/liveRecordingService";
import { syncTimelineThumbnails, capturePriorityThumbs } from "@/services/timelineThumbnailService";
import { refreshSessionLiveMetadata } from "@/services/youtubeService";

function isLiveStatus(liveStatus: string | null | undefined): boolean {
  return (
    liveStatus === "live" ||
    liveStatus === "upcoming" ||
    liveStatus === "post_live"
  );
}

/**
 * One live tick: sync recording, thumbnails, and metadata.
 * Called from the client every ~15s while a stream session is active.
 */
export async function runLivePipeline(streamSessionId: string) {
  const results: Record<string, unknown> = {};

  const fresh = await prisma.streamSession.findUnique({
    where: { id: streamSessionId },
    include: { liveRecording: true },
  });
  if (!fresh) throw new Error("Session not found");

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

  // Sync growing recording file
  if (
    fresh.liveRecording?.status === "recording" ||
    fresh.liveStatus === "live" ||
    fresh.liveStatus === "upcoming"
  ) {
    if (fresh.liveRecording?.status !== "recording") {
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
    results.recording = await syncLiveRecording(streamSessionId);
  }

  // Recording only — transcription runs on /transcribe (avoids 2min+ live-tick hangs)
  const sourceMedia = await prisma.sourceMedia.findFirst({
    where: { streamSessionId },
    orderBy: { createdAt: "desc" },
  });

  if (sourceMedia && (sourceMedia.durationSeconds ?? 0) >= 3) {
    const isLive = isLiveStatus(fresh.liveStatus);
    await capturePriorityThumbs(streamSessionId, {
      prioritizeTail: isLive,
    }).catch((error) => {
      results.thumbnailError =
        error instanceof Error ? error.message : String(error);
    });
    void syncTimelineThumbnails(streamSessionId, { prioritizeTail: isLive }).catch(
      () => {}
    );
    results.thumbnailsQueued = true;
  }

  return results;
}
