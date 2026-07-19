import { triggerFileDownload } from "@/lib/clientDownload";
import { clipDownloadUrl, renderJobDownloadUrl } from "@/lib/downloadUrls";
import { formatSeconds } from "@/lib/time";
import type { RenderFormat } from "@/lib/renderFormat";
import type { ClipSelection } from "@/components/LiveTimeline";
import type { CaptionAppearance } from "@/lib/captionAppearance";
import type { CaptionCue } from "@/lib/captionTrack";
import type { EditorState } from "@/lib/editorState";

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

export class RenderAbortedError extends Error {
  constructor(message = "Render cancelled") {
    super(message);
    this.name = "RenderAbortedError";
  }
}

function isAbortError(err: unknown): boolean {
  if (err instanceof RenderAbortedError) return true;
  if (!err || typeof err !== "object") return false;
  const name = "name" in err ? String(err.name) : "";
  return name === "AbortError" || name === "RenderAbortedError";
}

export { isAbortError };

async function pollRenderJob(
  jobId: string,
  onProgress?: (update: RenderProgressUpdate) => void,
  signal?: AbortSignal
): Promise<{ downloadUrl: string }> {
  const started = Date.now();
  const timeoutMs = 10 * 60 * 1000;
  let consecutiveErrors = 0;

  while (Date.now() - started < timeoutMs) {
    if (signal?.aborted) throw new RenderAbortedError();

    let status = "queued";
    let progress = 0;
    try {
      const res = await fetch(`/api/render-jobs/${jobId}`, { signal });
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

      consecutiveErrors = 0;
      status = data.job.status;
      progress = data.job.progress;

      onProgress?.({
        progress,
        status,
        errorMessage: data.job.errorMessage,
      });

      if (status === "completed") {
        return { downloadUrl: renderJobDownloadUrl(jobId) };
      }
      if (status === "failed") {
        throw new Error(data.job.errorMessage ?? "Render failed");
      }
    } catch (err) {
      if (isAbortError(err) || signal?.aborted) throw new RenderAbortedError();
      consecutiveErrors += 1;
      // Dev recompile / brief network blips should not kill a long encode.
      if (consecutiveErrors >= 8) throw err;
    }

    // Faster while queued / early progress; ease off during long encodes.
    const delayMs =
      consecutiveErrors > 0
        ? 1200
        : status === "queued" || progress < 55
          ? 350
          : 900;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, delayMs);
      if (!signal) return;
      const onAbort = () => {
        clearTimeout(timer);
        reject(new RenderAbortedError());
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  throw new Error("Timed out waiting for render");
}

export async function renderClip(
  clipId: string,
  format: RenderFormat = "native",
  includeCaptions = false,
  captionAppearance?: CaptionAppearance,
  captionCues?: CaptionCue[],
  onProgress?: (update: RenderProgressUpdate) => void,
  editorState?: EditorState,
  signal?: AbortSignal,
  verticalLayout?: unknown
) {
  if (signal?.aborted) throw new RenderAbortedError();
  onProgress?.({ progress: 5, status: "queued" });

  let res: Response;
  try {
    res = await fetch(`/api/clips/${clipId}/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        includeCaptions,
        format,
        captionAppearance,
        captionCues,
        editorState,
        verticalLayout: format === "vertical" ? verticalLayout : undefined,
      }),
      signal,
    });
  } catch (err) {
    if (isAbortError(err) || signal?.aborted) throw new RenderAbortedError();
    throw err;
  }
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

  const polled = await pollRenderJob(jobId, onProgress, signal);

  return {
    jobId,
    downloadUrl: polled.downloadUrl ?? data.downloadUrl ?? clipDownloadUrl(clipId),
  };
}

export async function saveAndRenderClip(
  sessionId: string,
  selection: ClipSelection,
  title?: string,
  format: RenderFormat = "native",
  includeCaptions = false,
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
