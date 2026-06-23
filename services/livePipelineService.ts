import { prisma } from "@/lib/db";
import { syncLiveRecording } from "@/services/liveRecordingService";
import { pollChatMessages } from "@/services/chatIngestionService";
import { processChatWindows } from "@/services/eventWindowService";
import { autoSuggestClips } from "@/services/suggestClipsService";
import { processVideoIncremental } from "@/services/mediaService";

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

  // Sync growing recording file
  if (
    session.liveRecording?.status === "recording" ||
    session.liveStatus === "live"
  ) {
    results.recording = await syncLiveRecording(streamSessionId);
  }

  // Poll chat if tracking is on
  if (session.chatTracking?.isActive && session.activeLiveChatId) {
    try {
      results.chat = await pollChatMessages(streamSessionId);
      results.chatWindows = await processChatWindows(streamSessionId);
    } catch (e) {
      results.chatError = e instanceof Error ? e.message : String(e);
    }
  } else if (session.activeLiveChatId && isLiveStatus(session.liveStatus)) {
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

  // Auto-suggest clips from hype moments
  if (isLiveStatus(session.liveStatus) || session.liveStatus === "post_live") {
    results.suggestions = await autoSuggestClips(streamSessionId, 3);
  }

  // Incremental media analysis on recorded portion (lightweight)
  const sourceMedia = await prisma.sourceMedia.findFirst({
    where: { streamSessionId },
    orderBy: { createdAt: "desc" },
  });
  if (
    sourceMedia &&
    (sourceMedia.durationSeconds ?? 0) > 30 &&
    isLiveStatus(session.liveStatus)
  ) {
    try {
      results.processing = await processVideoIncremental(streamSessionId);
    } catch (e) {
      results.processingError = e instanceof Error ? e.message : String(e);
    }
  }

  return results;
}
