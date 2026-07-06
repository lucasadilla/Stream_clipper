import { triggerFileDownload } from "@/lib/clientDownload";
import { clipDownloadUrl } from "@/lib/downloadUrls";
import { formatSeconds } from "@/lib/time";
import type { RenderFormat } from "@/lib/renderFormat";
import type { ClipSelection } from "@/components/LiveTimeline";
import type { CaptionAppearance } from "@/lib/captionAppearance";

export interface RenderProgressUpdate {
  progress: number;
  status: string;
  errorMessage?: string | null;
}

const RENDER_POLL_MS = 1000;
const RENDER_TIMEOUT_MS = 30 * 60 * 1000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
): Promise<{ jobId: string; downloadUrl: string }> {
  const deadline = Date.now() + RENDER_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const res = await fetch(`/api/render-jobs/${jobId}`);
    const data = (await res.json()) as {
      job?: {
        status: string;
        progress: number;
        errorMessage?: string | null;
      };
      error?: string;
    };

    if (!res.ok) {
      throw new Error(data.error ?? "Failed to check render status");
    }

    const job = data.job;
    if (!job) throw new Error("Render job not found");

    onProgress?.({
      progress: job.progress ?? 0,
      status: job.status,
      errorMessage: job.errorMessage,
    });

    if (job.status === "completed") {
      return {
        jobId,
        downloadUrl: `/api/render-jobs/${jobId}/download`,
      };
    }

    if (job.status === "failed") {
      throw new Error(job.errorMessage ?? "Render failed");
    }

    await sleep(RENDER_POLL_MS);
  }

  throw new Error(
    "Render timed out after 30 minutes. Try a shorter clip or wait for the source download to finish."
  );
}

export async function renderClip(
  clipId: string,
  format: RenderFormat = "vertical",
  includeCaptions = true,
  captionAppearance?: CaptionAppearance,
  onProgress?: (update: RenderProgressUpdate) => void
) {
  const res = await fetch(`/api/clips/${clipId}/render`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ includeCaptions, format, captionAppearance }),
  });
  const data = (await res.json()) as {
    jobId?: string;
    downloadUrl?: string;
    error?: string;
  };

  if (!res.ok) {
    throw new Error(data.error ?? "Render failed");
  }

  if (!data.jobId) {
    throw new Error("Render did not return a job id");
  }

  onProgress?.({ progress: 5, status: "processing" });

  if (data.downloadUrl && res.status === 200) {
    return { jobId: data.jobId, downloadUrl: data.downloadUrl };
  }

  return pollRenderJob(data.jobId, onProgress);
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
  const result = await renderClip(
    clip.id,
    format,
    includeCaptions,
    captionAppearance,
    onProgress
  );
  const url = result.downloadUrl ?? clipDownloadUrl(clip.id);
  const suffix = format === "native" ? "-native" : "-vertical";
  await triggerFileDownload(url, `${clip.title || "clip"}${suffix}.mp4`);
  return clip;
}
