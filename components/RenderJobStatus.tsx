"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/cn";
import { renderJobDownloadUrl } from "@/lib/downloadUrls";
import { triggerFileDownload } from "@/lib/clientDownload";
import type { RenderJobLogEntry } from "@/lib/renderJobLogs";

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
          await triggerFileDownload(fileUrl, `short-${jobId}.mp4`);
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

  async function handleDownload() {
    setDownloading(true);
    try {
      await triggerFileDownload(fileUrl, `short-${jobId}.mp4`);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="rounded-lg border border-[var(--color-card-border)] bg-[var(--color-background)] p-3 text-xs">
      <div className="flex items-center justify-between mb-2">
        <span className={cn("font-medium capitalize", statusColor)}>
          {job.status}
          {typeof job.attempts === "number" && job.attempts > 0 && (
            <span className="ml-1.5 font-normal text-[var(--color-muted)]">
              · attempt {job.attempts}
              {job.maxAttempts ? `/${job.maxAttempts}` : ""}
            </span>
          )}
        </span>
        <span>{Math.round(job.progress)}%</span>
      </div>
      {inFlight && (
        <div className="h-1.5 rounded-full bg-[var(--color-card)]">
          <div
            className="h-full rounded-full bg-[var(--color-accent)] transition-all"
            style={{ width: `${Math.max(job.progress, job.status === "queued" ? 4 : 0)}%` }}
          />
        </div>
      )}
      {job.status === "completed" && (
        <button
          type="button"
          onClick={handleDownload}
          disabled={downloading}
          className="mt-2 w-full py-2 rounded-lg bg-[var(--color-success)] text-white font-semibold text-sm disabled:opacity-50"
        >
          {downloading ? "Downloading…" : "Download Short"}
        </button>
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
