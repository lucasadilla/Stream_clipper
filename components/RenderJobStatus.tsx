"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { renderJobDownloadUrl } from "@/lib/downloadUrls";
import { triggerFileDownload } from "@/lib/clientDownload";

interface RenderJob {
  id: string;
  status: string;
  progress: number;
  outputPath?: string | null;
  errorMessage?: string | null;
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
        }, 2000);
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
        <span className={cn("font-medium capitalize", statusColor)}>{job.status}</span>
        <span>{Math.round(job.progress)}%</span>
      </div>
      {job.status === "processing" && (
        <div className="h-1.5 rounded-full bg-[var(--color-card)]">
          <div
            className="h-full rounded-full bg-[var(--color-accent)] transition-all"
            style={{ width: `${job.progress}%` }}
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
    </div>
  );
}
