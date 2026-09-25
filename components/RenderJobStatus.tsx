"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/cn";
import { renderJobDownloadUrl } from "@/lib/downloadUrls";
import { triggerFileDownload } from "@/lib/clientDownload";
import { videoDownloadFilename } from "@/lib/downloadFilename";
import type { RenderJobLogEntry } from "@/lib/renderJobLogs";
import type { PostRenderQualityReview } from "@/lib/postRenderCritic";
import { OperationProgress } from "@/components/ui/operation-progress";

interface RenderJob {
  id: string;
  status: string;
  progress: number;
  outputPath?: string | null;
  errorMessage?: string | null;
  attempts?: number;
  maxAttempts?: number;
  startedAt?: string | null;
  completedAt?: string | null;
  logs?: RenderJobLogEntry[] | null;
  qualityReview?: PostRenderQualityReview | null;
  downloadFilename?: string;
}

interface RenderJobStatusProps {
  jobId: string;
  downloadUrl?: string;
  onComplete?: (outputPath: string) => void;
}

export function RenderJobStatus({
  jobId,
  downloadUrl,
  onComplete,
}: RenderJobStatusProps) {
  const [job, setJob] = useState<RenderJob | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const fileUrl = downloadUrl ?? renderJobDownloadUrl(jobId);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      const res = await fetch(`/api/render-jobs/${jobId}`);
      const data = await res.json();
      if (!res.ok || !data.job || cancelled) return false;

      setJob(data.job);

      if (data.job.status === "completed" && data.job.outputPath) {
        onComplete?.(data.job.outputPath);
        try {
          await triggerFileDownload(
            fileUrl,
            data.job.downloadFilename || videoDownloadFilename("Clipper Export")
          );
        } catch {
          // User can click Download Short below
        }
        return true;
      }
      if (data.job.status === "failed") return true;
      return false;
    }

    let interval: ReturnType<typeof setInterval>;

    poll().then((done) => {
      if (!done && !cancelled) {
        interval = setInterval(async () => {
          const finished = await poll();
          if (finished) clearInterval(interval);
        }, 1500);
      }
    });

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [jobId, fileUrl, onComplete]);

  if (!job) return null;

  const statusColor =
    job.status === "completed"
      ? "text-[var(--color-success)]"
      : job.status === "failed"
        ? "text-[var(--color-danger)]"
        : "text-[var(--color-warning)]";

  const logs = Array.isArray(job.logs) ? job.logs : [];
  const inFlight = job.status === "queued" || job.status === "processing";
  const latestStep = logs[logs.length - 1]?.step;
  const renderStage =
    latestStep === "prepare_source"
      ? "Preparing source media…"
      : latestStep === "download_source" || latestStep?.startsWith("download_source_attempt_")
        ? "Fetching the full-quality source…"
      : latestStep === "source_ready"
        ? "Source ready; assembling the edit…"
        : latestStep === "captions"
          ? "Compositing captions…"
            : latestStep === "cutting" || latestStep === "encoding"
            ? "Encoding the final video…"
            : latestStep === "quality_check"
              ? "Reviewing export quality…"
              : latestStep === "finalizing"
                ? "Finalizing the download…"
                : job.status === "queued"
                  ? "Waiting for an available render worker…"
                  : "Rendering frames…";

  async function handleDownload() {
    setDownloading(true);
    try {
      await triggerFileDownload(
        fileUrl,
        job?.downloadFilename || videoDownloadFilename("Clipper Export")
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="rounded-lg border border-[var(--color-card-border)] bg-[var(--color-background)] p-3 text-xs">
      {inFlight && (
        <OperationProgress
          compact
          title={job.status === "queued" ? "Render queued" : "Rendering video"}
          detail={renderStage}
          progress={job.progress > 0 ? job.progress : null}
          startedAt={job.startedAt}
          resetKey={jobId}
        />
      )}
      {!inFlight && (
        <div className="mb-2 flex items-center justify-between">
          <span className={cn("font-medium capitalize", statusColor)}>
            {job.status}
          </span>
          <span>{Math.round(job.progress)}%</span>
        </div>
      )}
      {inFlight && typeof job.attempts === "number" && job.attempts > 0 && (
        <p className="mt-1.5 text-[10px] text-[var(--color-muted)]">
          Attempt {job.attempts}{job.maxAttempts ? `/${job.maxAttempts}` : ""}
        </p>
      )}
      {job.status === "completed" && (
        <>
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            className="mt-2 w-full py-2 rounded-lg bg-[var(--color-success)] text-white font-semibold text-sm disabled:opacity-50"
          >
            {downloading ? "Downloading…" : "Download Short"}
          </button>
          {job.qualityReview && (
            <div className="mt-3 border-t border-[var(--color-card-border)] pt-3">
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold text-white">
                  {job.qualityReview.reviewer === "ai_visual"
                    ? "AI export critic"
                    : "Export quality check"}
                </span>
                <span
                  className={cn(
                    "font-semibold tabular-nums",
                    job.qualityReview.verdict === "pass"
                      ? "text-[var(--color-success)]"
                      : job.qualityReview.verdict === "fail"
                        ? "text-[var(--color-danger)]"
                        : "text-[var(--color-warning)]"
                  )}
                >
                  {job.qualityReview.score}/100
                </span>
              </div>
              <p className="mt-1 leading-relaxed text-[var(--color-muted)]">
                {job.qualityReview.summary}
              </p>
            </div>
          )}
        </>
      )}
      {job.status === "failed" && job.errorMessage && (
        <p className="mt-1 text-[var(--color-danger)]">{job.errorMessage}</p>
      )}
      {logs.length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowLogs((v) => !v)}
            className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)] hover:text-white"
          >
            {showLogs ? "Hide logs" : "Show logs"}
          </button>
          {showLogs && (
            <ul className="mt-1 max-h-32 space-y-1 overflow-y-auto rounded border border-[var(--color-card-border)] bg-[#050705] p-2 font-mono text-[10px] text-[var(--color-muted)]">
              {logs.slice(-20).map((entry, i) => (
                <li key={`${entry.at}-${i}`}>
                  <span
                    className={cn(
                      entry.level === "error" && "text-[var(--color-danger)]",
                      entry.level === "warn" && "text-[var(--color-warning)]"
                    )}
                  >
                    [{entry.step}] {entry.message}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
