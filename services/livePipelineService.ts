import { prisma } from "@/lib/db";
import { syncLiveRecording } from "@/services/liveRecordingService";
import { pollChatMessages } from "@/services/chatIngestionService";
import { processChatWindows } from "@/services/eventWindowService";
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
 * One live tick: sync recording, poll chat, score windows, suggest clips, incremental analysis.
 * Called from the client every ~15s while a stream session is active.
 */
export async function runLivePipeline(streamSessionId: string) {
  const session = await prisma.streamSession.findUnique({
    where: { id: streamSessionId },
    include: { chatTracking: true, liveRecording: true },
  });
  if (!session) throw new Error("Session not found");

  const results: Record<string, unknown> = {};

  const fresh = await prisma.streamSession.findUnique({
    where: { id: streamSessionId },
    include: { chatTracking: true, liveRecording: true },
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

  // Poll chat if tracking is on
  if (fresh.chatTracking?.isActive && fresh.activeLiveChatId) {
    try {
      results.chat = await pollChatMessages(streamSessionId);
      results.chatWindows = await processChatWindows(streamSessionId);
    } catch (e) {
      results.chatError = e instanceof Error ? e.message : String(e);
    }
  } else if (fresh.activeLiveChatId && isLiveStatus(fresh.liveStatus)) {
    // Auto-start chat on first live tick
    try {
      const { startChatTracking } = await import(
        "@/services/chatIngestionService"
      );
      results.chat = await startChatTracking(streamSessionId);
      results.chatWindows = await processChatWindows(streamSessionId);
    } catch {
      // chat may not be available yet
    }
  }

  // Auto-suggest clips removed from UI — skip to reduce API load
  // if (isLiveStatus(session.liveStatus) || session.liveStatus === "post_live") {
  //   results.suggestions = await autoSuggestClips(streamSessionId, 3);
  // }

  // Recording + chat only — transcription runs on /transcribe (avoids 2min+ live-tick hangs)
  const sourceMedia = await prisma.sourceMedia.findFirst({
    where: { streamSessionId },
    orderBy: { createdAt: "desc" },
  });

  if (sourceMedia && (sourceMedia.durationSeconds ?? 0) >= 3) {
    const isLive = isLiveStatus(fresh.liveStatus);
    void capturePriorityThumbs(streamSessionId, { prioritizeTail: isLive }).catch(
      () => {}
    );
    void syncTimelineThumbnails(streamSessionId, { prioritizeTail: isLive }).catch(
      () => {}
    );
    results.thumbnailsQueued = true;
  }

  return results;
}
