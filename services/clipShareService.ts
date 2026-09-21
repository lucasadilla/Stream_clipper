import { prisma } from "@/lib/db";
import { getLatestCompletedFinalRenderJob } from "@/services/renderSelectionService";
import { inspectDeliverableVideo } from "@/services/deliverableVideoService";

export interface ClipSharePayload {
  id: string;
  title: string;
  reason: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  durationSeconds: number;
  status: string;
  stream: {
    title: string | null;
    channelTitle: string | null;
    thumbnailUrl: string | null;
  };
  hasVideo: boolean;
  videoUrl: string | null;
  downloadUrl: string | null;
  sharePath: string;
  createdAt: string;
}

export async function getClipSharePayload(
  clipSuggestionId: string
): Promise<ClipSharePayload | null> {
  const clip = await prisma.clipSuggestion.findUnique({
    where: { id: clipSuggestionId },
    include: {
      streamSession: {
        select: {
          title: true,
          channelTitle: true,
          thumbnailUrl: true,
        },
      },
    },
  });

  if (!clip) return null;

  const renderJob = await getLatestCompletedFinalRenderJob(clip.id);
  const hasVideo = renderJob?.outputPath
    ? (
        await inspectDeliverableVideo(renderJob.outputPath, {
          relativeToStorage: true,
        })
      ).ok
    : false;

  return {
    id: clip.id,
    title: clip.title,
    reason: clip.reason,
    startTimeSeconds: clip.startTimeSeconds,
    endTimeSeconds: clip.endTimeSeconds,
    durationSeconds: clip.endTimeSeconds - clip.startTimeSeconds,
    status: clip.status,
    stream: {
      title: clip.streamSession.title,
      channelTitle: clip.streamSession.channelTitle,
      thumbnailUrl: clip.streamSession.thumbnailUrl,
    },
    hasVideo,
    videoUrl: hasVideo ? `/api/clips/${clip.id}/stream` : null,
    downloadUrl: hasVideo ? `/api/clips/${clip.id}/download` : null,
    sharePath: `/clips/${clip.id}`,
    createdAt: clip.createdAt.toISOString(),
  };
}

export async function getLatestRenderOutputPath(
  clipSuggestionId: string
): Promise<string | null> {
  const job = await getLatestCompletedFinalRenderJob(clipSuggestionId);
  if (!job?.outputPath) return null;
  const inspection = await inspectDeliverableVideo(job.outputPath, {
    relativeToStorage: true,
  });
  return inspection.ok ? job.outputPath : null;
}
