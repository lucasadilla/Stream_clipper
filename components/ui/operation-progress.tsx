"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/cn";

function startTime(value?: string | number | Date | null): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = new Date(value).getTime();
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

export function useOperationElapsed(
  active = true,
  resetKey?: string,
  startedAt?: string | number | Date | null
): number {
  const startRef = useRef(startTime(startedAt));
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    startRef.current = startTime(startedAt);
    setElapsedSeconds(0);
  }, [resetKey, startedAt]);

  useEffect(() => {
    if (!active) return;
    const update = () => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startRef.current) / 1000)));
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [active, resetKey, startedAt]);

  return elapsedSeconds;
}

export function formatOperationElapsed(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export function OperationProgress({
  title,
  detail,
  progress,
  stages = [],
  active = true,
  resetKey,
  startedAt,
  compact = false,
  className,
}: {
  title: string;
  detail?: string;
  progress?: number | null;
  stages?: readonly string[];
  active?: boolean;
  resetKey?: string;
  startedAt?: string | number | Date | null;
  compact?: boolean;
  className?: string;
}) {
  const elapsedSeconds = useOperationElapsed(active, resetKey, startedAt);
  const incomingProgress =
    typeof progress === "number" && Number.isFinite(progress)
      ? Math.max(0, Math.min(100, progress))
      : null;
  const [displayedProgress, setDisplayedProgress] = useState<number | null>(
    incomingProgress && incomingProgress > 0 ? incomingProgress : null
  );
  useEffect(() => {
    setDisplayedProgress(null);
  }, [resetKey]);
  useEffect(() => {
    if (incomingProgress === null || incomingProgress <= 0) {
      setDisplayedProgress(null);
      return;
    }
    setDisplayedProgress((current) => Math.max(current ?? 0, incomingProgress));
  }, [incomingProgress]);
  const realProgress = displayedProgress;
  const determinate = realProgress !== null && realProgress > 0;
  const stage = useMemo(() => {
    if (!stages.length) return detail;
    const index = Math.min(
      stages.length - 1,
      Math.floor(elapsedSeconds / (compact ? 4 : 6))
    );
    return stages[index] ?? detail;
  }, [compact, detail, elapsedSeconds, stages]);

  return (
    <div className={cn("w-full", compact ? "space-y-2" : "space-y-3", className)}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <LoaderCircle
            className={cn(
              "shrink-0 animate-spin text-[var(--color-accent)] motion-reduce:animate-none",
              compact ? "size-3.5" : "size-4"
            )}
            aria-hidden="true"
          />
          <div className="min-w-0">
            <p className={cn("font-medium text-white", compact ? "text-xs" : "text-sm")}>
              {title}
            </p>
            {(stage || detail) && (
              <p className="mt-0.5 truncate text-[11px] text-[var(--color-muted)]">
                {stage ?? detail}
              </p>
            )}
          </div>
        </div>
        <span className="shrink-0 font-mono text-[11px] font-semibold tabular-nums text-[var(--color-accent)]">
          {determinate ? `${Math.round(realProgress)}% · ` : ""}
          {formatOperationElapsed(elapsedSeconds)}
        </span>
      </div>

      <div
        className={cn(
          "relative w-full overflow-hidden bg-white/[0.08]",
          compact ? "h-1" : "h-1.5"
        )}
        role="progressbar"
        aria-label={title}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={determinate ? Math.round(realProgress) : undefined}
      >
        {determinate ? (
          <div
            className="h-full bg-[var(--color-accent)] transition-[width] duration-700 ease-out"
            style={{ width: `${Math.max(3, realProgress)}%` }}
          />
        ) : (
          <div className="absolute inset-y-0 w-2/5 animate-[agent-indeterminate_1.35s_ease-in-out_infinite] bg-[var(--color-accent)] motion-reduce:left-0 motion-reduce:w-1/3 motion-reduce:animate-none" />
        )}
      </div>
    </div>
  );
}
