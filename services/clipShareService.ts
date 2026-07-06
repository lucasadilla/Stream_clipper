import { prisma } from "@/lib/db";

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
      renderJobs: {
        where: { status: "completed", outputPath: { not: null } },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { outputPath: true },
      },
    },
  });

  if (!clip) return null;

  const hasVideo = Boolean(clip.renderJobs[0]?.outputPath);

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
  const job = await prisma.renderJob.findFirst({
    where: {
      clipSuggestionId,
      status: "completed",
      outputPath: { not: null },
    },
    orderBy: { createdAt: "desc" },
    select: { outputPath: true },
  });
  return job?.outputPath ?? null;
}
