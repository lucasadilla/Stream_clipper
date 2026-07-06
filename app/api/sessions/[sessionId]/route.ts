import { NextRequest } from "next/server";
import { getStreamSession, refreshSessionLiveMetadata } from "@/services/youtubeService";
import {
  clearSessionStorage,
  deleteStreamSession,
  getSessionStorageInfo,
} from "@/services/sessionCleanupService";
import { errorResponse, jsonResponse } from "@/lib/utils";
import { resolveVideoDurationFromMetadata } from "@/lib/youtube";
import { readStreamEmbed } from "@/lib/streamPlatform";
import type { StreamPlatform } from "@/lib/streamPlatform";
import { isBrowserPlayableVideoUrl } from "@/lib/streamPlatform";
import {
  buildPreviewVideoUrl,
  getPreviewVideoRelativePath,
  previewMp4Ready,
} from "@/services/previewVideoService";
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
        platform: session.platform ?? "youtube",
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
        sourceMedia: await Promise.all(
          session.sourceMedia.map(async (m) => {
          const hasFile = m.filePath ? fileExists(m.filePath) : false;
          const sourceVideoUrl = hasFile
            ? `/api/storage/${m.filePath.replace(/\\/g, "/")}?inline=1`
            : null;
          const previewRelative = getPreviewVideoRelativePath(sessionId);
          const previewReady = await previewMp4Ready(sessionId);
          const previewVideoUrl = previewReady
            ? buildPreviewVideoUrl(previewRelative)
            : null;
          const sourceIsPlayableMp4 = isBrowserPlayableVideoUrl(sourceVideoUrl);
          return {
            id: m.id,
            durationSeconds: m.durationSeconds,
            isLiveRecording: m.isLiveRecording,
            sizeBytes: m.sizeBytes.toString(),
            sourceVideoUrl,
            previewVideoUrl,
            sourceIsPlayableMp4,
          };
        })
        ),
        storageBytes: storage?.storageBytes ?? 0,
        storageLabel: storage?.storageLabel ?? "0 B",
        streamEmbed: readStreamEmbed(session.metadataJson),
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
