import { triggerFileDownload } from "@/lib/clientDownload";
import { clipDownloadUrl } from "@/lib/downloadUrls";
import { formatSeconds } from "@/lib/time";
import type { RenderFormat } from "@/lib/renderFormat";
import type { ClipSelection } from "@/components/LiveTimeline";
import type { CaptionAppearance } from "@/lib/captionAppearance";
import type { CaptionCue } from "@/lib/captionTrack";

export interface RenderProgressUpdate {
  progress: number;
  status: string;
  errorMessage?: string | null;
}

export async function saveClip(
  sessionId: string,
  selection: ClipSelection,
  title?: string
) {
  const res = await fetch(`/api/sessions/${sessionId}/clips`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: title || `Clip ${formatSeconds(selection.start)}`,
      startTimeSeconds: selection.start,
      endTimeSeconds: selection.end,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Failed to create clip");
  return data.clip as { id: string; title: string };
}

export async function renderClip(
  clipId: string,
  format: RenderFormat = "vertical",
  includeCaptions = true,
  captionAppearance?: CaptionAppearance,
  captionCues?: CaptionCue[],
  onProgress?: (update: RenderProgressUpdate) => void
) {
  onProgress?.({ progress: 20, status: "processing" });

  const res = await fetch(`/api/clips/${clipId}/render`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      includeCaptions,
      format,
      captionAppearance,
      captionCues,
    }),
  });
  const data = (await res.json()) as {
    jobId?: string;
    downloadUrl?: string;
    error?: string;
  };

  if (!res.ok) {
    throw new Error(data.error ?? "Render failed");
  }

  onProgress?.({ progress: 100, status: "completed" });

  return {
    jobId: data.jobId!,
    downloadUrl: data.downloadUrl ?? clipDownloadUrl(clipId),
  };
}

export async function saveAndRenderClip(
  sessionId: string,
  selection: ClipSelection,
  title?: string,
  format: RenderFormat = "vertical",
  includeCaptions = true,
  captionAppearance?: CaptionAppearance,
  onProgress?: (update: RenderProgressUpdate) => void
) {
  const clip = await saveClip(sessionId, selection, title);
  onProgress?.({ progress: 8, status: "processing" });
  const result = await renderClip(
    clip.id,
    format,
    includeCaptions,
    captionAppearance,
    undefined,
    onProgress
  );
  const url = result.downloadUrl ?? clipDownloadUrl(clip.id);
  const suffix = format === "native" ? "-native" : "-vertical";
  await triggerFileDownload(url, `${clip.title || "clip"}${suffix}.mp4`);
  return clip;
}
