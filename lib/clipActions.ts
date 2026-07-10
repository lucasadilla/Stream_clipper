import { triggerFileDownload } from "@/lib/clientDownload";
import { clipDownloadUrl, renderJobDownloadUrl } from "@/lib/downloadUrls";
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

async function pollRenderJob(
  jobId: string,
  onProgress?: (update: RenderProgressUpdate) => void
): Promise<{ downloadUrl: string }> {
  const started = Date.now();
  const timeoutMs = 10 * 60 * 1000;

  while (Date.now() - started < timeoutMs) {
    const res = await fetch(`/api/render-jobs/${jobId}`);
    const data = (await res.json()) as {
      job?: {
        status: string;
        progress: number;
        errorMessage?: string | null;
        outputPath?: string | null;
      };
      error?: string;
    };
    if (!res.ok || !data.job) {
      throw new Error(data.error ?? "Failed to poll render job");
    }

    onProgress?.({
      progress: data.job.progress,
      status: data.job.status,
      errorMessage: data.job.errorMessage,
    });

    if (data.job.status === "completed") {
      return { downloadUrl: renderJobDownloadUrl(jobId) };
    }
    if (data.job.status === "failed") {
      throw new Error(data.job.errorMessage ?? "Render failed");
    }

    await new Promise((r) => setTimeout(r, 1500));
  }

  throw new Error("Timed out waiting for render");
}

export async function renderClip(
  clipId: string,
  format: RenderFormat = "vertical",
  includeCaptions = true,
  captionAppearance?: CaptionAppearance,
  captionCues?: CaptionCue[],
  onProgress?: (update: RenderProgressUpdate) => void
) {
  onProgress?.({ progress: 5, status: "queued" });

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
    status?: string;
    error?: string;
  };

  if (!res.ok) {
    throw new Error(data.error ?? "Render failed");
  }

  const jobId = data.jobId!;
  onProgress?.({ progress: 10, status: data.status ?? "queued" });

  const polled = await pollRenderJob(jobId, onProgress);

  return {
    jobId,
    downloadUrl: polled.downloadUrl ?? data.downloadUrl ?? clipDownloadUrl(clipId),
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
