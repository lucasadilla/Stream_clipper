import { NextRequest } from "next/server";
import { getStreamSession, refreshSessionLiveMetadata } from "@/services/youtubeService";
import {
  clearSessionStorage,
  deleteStreamSession,
  getSessionStorageInfo,
} from "@/services/sessionCleanupService";
import { errorResponse, jsonResponse } from "@/lib/utils";
import { resolveVideoDurationFromMetadata } from "@/lib/youtube";
import { fileExists } from "@/lib/storage";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    let session = await getStreamSession(sessionId);
    if (!session) return errorResponse("Session not found", 404);

    let videoDurationSeconds = resolveVideoDurationFromMetadata(
      session.metadataJson,
      {
        actualStartTime: session.actualStartTime,
        liveStatus: session.liveStatus,
      }
    );

    if (videoDurationSeconds <= 0) {
      await refreshSessionLiveMetadata(sessionId);
      const refreshed = await getStreamSession(sessionId);
      if (refreshed) {
        session = refreshed;
        videoDurationSeconds = resolveVideoDurationFromMetadata(
          refreshed.metadataJson,
          {
            actualStartTime: refreshed.actualStartTime,
            liveStatus: refreshed.liveStatus,
          }
        );
      }
    }

    const storage = await getSessionStorageInfo(sessionId);

    return jsonResponse({
      session: {
        id: session.id,
        youtubeVideoId: session.youtubeVideoId,
        youtubeUrl: session.youtubeUrl,
        title: session.title,
        liveStatus: session.liveStatus,
        activeLiveChatId: session.activeLiveChatId,
        actualStartTime: session.actualStartTime,
        videoDurationSeconds,
        concurrentViewers: session.concurrentViewers,
        liveRecording: session.liveRecording
          ? {
              status: session.liveRecording.status,
              recordedSeconds: session.liveRecording.recordedSeconds,
            }
          : null,
        sourceMedia: session.sourceMedia.map((m) => {
          const hasFile = m.filePath ? fileExists(m.filePath) : false;
          const sourceVideoUrl = hasFile
            ? `/api/storage/${m.filePath.replace(/\\/g, "/")}?inline=1`
            : null;
          return {
            id: m.id,
            durationSeconds: m.durationSeconds,
            isLiveRecording: m.isLiveRecording,
            sizeBytes: m.sizeBytes.toString(),
            sourceVideoUrl,
          };
        }),
        storageBytes: storage?.storageBytes ?? 0,
        storageLabel: storage?.storageLabel ?? "0 B",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch session";
    return errorResponse(message, 500);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const filesOnly = request.nextUrl.searchParams.get("filesOnly") === "1";

    const result = filesOnly
      ? await clearSessionStorage(sessionId)
      : await deleteStreamSession(sessionId);

    return jsonResponse({
      success: true,
      filesOnly,
      freedBytes: result.freedBytes,
      storageLabel: result.storageLabel,
      fullyRemoved: result.fullyRemoved,
      orphanedPaths: result.orphanedPaths,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete session";
    if (message === "Session not found") {
      return errorResponse(message, 404);
    }
    return errorResponse(message, 500);
  }
}
