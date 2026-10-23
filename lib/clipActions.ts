import { operationKey, rememberedOperation, rememberOperation, operationDelay } from "@/lib/clientOperationRecovery";
import { triggerFileDownload } from "@/lib/clientDownload";
import { videoDownloadFilename } from "@/lib/downloadFilename";
import { clipDownloadUrl, renderJobDownloadUrl } from "@/lib/downloadUrls";
import { formatSeconds } from "@/lib/time";
import type { RenderFormat } from "@/lib/renderFormat";
import type { ClipSelection } from "@/components/LiveTimeline";
import type { CaptionAppearance } from "@/lib/captionAppearance";
import type { CaptionCue } from "@/lib/captionTrack";
import type { EditorState } from "@/lib/editorState";
import type { ClipSuggestionData } from "@/components/ClipSuggestionCard";
import type { PostRenderQualityReview } from "@/lib/postRenderCritic";

export interface RenderProgressUpdate {
  progress: number;
  status: string;
  stage?: string;
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
  return data.clip as ClipSuggestionData;
}

export class RenderAbortedError extends Error {
  constructor(message = "Render cancelled") {
    super(message);
    this.name = "RenderAbortedError";
  }
}

export class RenderJobFailedError extends Error {
  constructor(message = "Render failed") {
    super(message);
    this.name = "RenderJobFailedError";
  }
}

function isAbortError(err: unknown): boolean {
  if (err instanceof RenderAbortedError) return true;
  if (!err || typeof err !== "object") return false;
  const name = "name" in err ? String(err.name) : "";
  return name === "AbortError" || name === "RenderAbortedError";
}

export { isAbortError };

export async function pollRenderJob(
  jobId: string,
  onProgress?: (update: RenderProgressUpdate) => void,
  signal?: AbortSignal
): Promise<{
  downloadUrl: string;
  qualityReview: PostRenderQualityReview | null;
}> {
  const started = Date.now();
  const timeoutMs = 30 * 60 * 1000;
  let consecutiveErrors = 0;
  let lastSuccess = Date.now();

  while (Date.now() - started < timeoutMs) {
    if (signal?.aborted) throw new RenderAbortedError();

    let status = "queued";
    let progress = 0;
    try {
      const res = await fetch(`/api/render-jobs/${jobId}`, { cache: "no-store", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000) });
      const data = (await res.json()) as {
        job?: {
          status: string;
          progress: number;
          stage?: string;
          errorMessage?: string | null;
          outputPath?: string | null;
          qualityReview?: PostRenderQualityReview | null;
        };
        error?: string;
      };
      if ([401, 403, 404].includes(res.status)) throw new RenderJobFailedError(data.error || "This render is no longer accessible. Reopen the clip to try again.");
      if (!res.ok || !data.job) {
        throw new Error(data.error ?? "Failed to poll render job");
      }

      consecutiveErrors = 0;
      lastSuccess = Date.now();
      status = data.job.status;
      progress = data.job.progress;

      onProgress?.({
        progress,
        status,
        stage: data.job.stage,
        errorMessage: data.job.errorMessage,
      });

      if (status === "completed") {
        return {
          downloadUrl: renderJobDownloadUrl(jobId),
          qualityReview: data.job.qualityReview ?? null,
        };
      }
      if (status === "failed" || status === "cancelled") {
        throw new RenderJobFailedError(
          data.job.errorMessage ?? "Render failed"
        );
      }
    } catch (err) {
      if (err instanceof RenderAbortedError || signal?.aborted) throw new RenderAbortedError();
      // A failed job is a final server result, not a temporary polling error.
      // Retrying it used to reset the retry counter on every successful GET,
      // leaving the UI polling forever after the worker had already failed.
      if (err instanceof RenderJobFailedError) throw err;
      consecutiveErrors += 1;
      // Dev recompile / brief network blips should not kill a long encode.
      onProgress?.({ progress, status: "processing", stage: "reconnecting" });
      if (Date.now() - lastSuccess >= 2 * 60_000) throw new Error("Connection interrupted. Your render is saved on the server. Retry to resume the same job.");
    }

    // Faster while queued / early progress; ease off during long encodes.
    const delayMs =
      consecutiveErrors > 0
        ? Math.min(15_000, 1200 * 2 ** Math.min(4, consecutiveErrors - 1))
        : status === "queued" || progress < 55
          ? 350
          : 900;
    await operationDelay(delayMs, signal).catch(() => { throw new RenderAbortedError(); });
  }

  throw new Error("This render is still saved on the server. Reopen the clip and retry to resume checking its progress.");
}

export async function renderClip(
  clipId: string,
  format: RenderFormat = "native",
  includeCaptions = true,
  captionAppearance?: CaptionAppearance,
  captionCues?: CaptionCue[],
  onProgress?: (update: RenderProgressUpdate) => void,
  editorState?: EditorState,
  signal?: AbortSignal,
  verticalLayout?: unknown,
  branding?: import("@/lib/social/channelPreset").ChannelBranding,
  expectedRange?: { startTimeSeconds: number; endTimeSeconds: number }
) {
  if (signal?.aborted) throw new RenderAbortedError();
  onProgress?.({ progress: 5, status: "queued" });

  const requestBody = { includeCaptions, format, captionAppearance, branding, captionCues, editorState,
    verticalLayout: format === "vertical" ? verticalLayout : undefined, expectedRange };
  // A range is required for browser recovery, so an edited trim cannot resume an older cut.
  const key = expectedRange ? await operationKey("render", { clipId, ...requestBody }) : null;
  let jobId = rememberedOperation(key);
  if (jobId) {
    onProgress?.({ progress: 0, status: "processing", stage: "resuming" });
    try {
      const result = await pollRenderJob(jobId, onProgress, signal);
      return { jobId, ...result };
    } catch (error) {
      if (!(error instanceof RenderJobFailedError)) throw error;
      rememberOperation(key, null); jobId = null;
    }
  }
  let res: Response;
  try {
    res = await fetch(`/api/clips/${clipId}/render`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestBody), signal });
  } catch (err) {
    if (isAbortError(err) || signal?.aborted) throw new RenderAbortedError();
    throw err;
  }
  const data = await res.json() as { jobId?: string; error?: string; status?: string };
  if (!res.ok || !data.jobId) throw new Error(data.error || "Could not start the render. Your edits are saved; try again.");
  jobId = data.jobId;
  rememberOperation(key, jobId);
  onProgress?.({ progress: 10, status: data.status ?? "queued" });

  const polled = await pollRenderJob(jobId, onProgress, signal);

  return {
    jobId,
    downloadUrl: polled.downloadUrl,
    qualityReview: polled.qualityReview ?? null,
  };
}

export async function saveAndRenderClip(
  sessionId: string,
  selection: ClipSelection,
  title?: string,
  format: RenderFormat = "native",
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
  await triggerFileDownload(url, videoDownloadFilename(clip.title));
  return clip;
}
