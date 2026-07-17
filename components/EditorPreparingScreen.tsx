"use client";

import { EditorHeader } from "@/components/layout/EditorHeader";
import { formatDuration } from "@/lib/time";
import {
  EDITOR_READY_RATIO,
  type EditorReadiness,
} from "@/lib/editorReadiness";
import { cn } from "@/lib/cn";

function LoadingCircle({ size = "lg" }: { size?: "md" | "lg" }) {
  const dim = size === "lg" ? "h-12 w-12" : "h-8 w-8";
  return (
    <div
      className={cn(
        dim,
        "rounded-full border-2 border-[var(--color-accent)]/25 border-t-[var(--color-accent)] animate-spin"
      )}
      aria-hidden
    />
  );
}

function ProgressRow({
  label,
  ratio,
  detail,
}: {
  label: string;
  ratio: number;
  detail: string;
}) {
  const pct = Math.round(Math.max(0, Math.min(1, ratio)) * 100);
  const met = ratio >= EDITOR_READY_RATIO;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-semibold text-white">{label}</span>
        <span
          className={cn(
            "font-mono text-[11px] tabular-nums",
            met ? "text-[var(--color-accent)]" : "text-[var(--color-muted)]"
          )}
        >
          {pct}%
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[#152015]">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500 ease-out",
            met
              ? "bg-[var(--color-accent)]"
              : "bg-[var(--color-accent)]/70 shadow-[0_0_14px_rgba(149,255,0,0.35)]"
          )}
          style={{ width: `${Math.max(4, pct)}%` }}
        />
      </div>
      <p className="text-[10px] leading-4 text-[var(--color-muted)]">{detail}</p>
    </div>
  );
}

export function EditorPreparingScreen({
  title = "Editor",
  readiness,
}: {
  title?: string;
  readiness: EditorReadiness;
}) {
  const targetPct = Math.round(EDITOR_READY_RATIO * 100);
  return (
    <div className="editor-shell flex min-h-screen flex-col bg-[var(--color-background)]">
      <EditorHeader title={title} />
      <div className="flex flex-1 items-center justify-center px-6 py-10">
        <div className="flex w-full max-w-md flex-col items-center gap-8 text-center">
          <LoadingCircle size="lg" />

          <div className="space-y-2">
            <p className="text-lg font-semibold text-white">
              {readiness.statusMessage}
            </p>
            <p className="text-sm leading-5 text-[var(--color-muted)]">
              {readiness.detailMessage}
            </p>
            <p className="pt-1 text-[11px] text-[#6a7568]">
              {readiness.openingWithoutFullTranscript
                ? "Filmstrip is ready — transcript keeps building in the background."
                : `Opening once filmstrip reaches ${targetPct}% (transcript opens after ${targetPct}% or shortly if audio is delayed)`}
              {readiness.recordedSeconds > 0
                ? ` · ${formatDuration(readiness.recordedSeconds)} media`
                : ""}
              .
            </p>
          </div>

          <div className="w-full space-y-5 rounded-lg border border-[var(--color-card-border)] bg-[#050705] px-4 py-4 text-left">
            <ProgressRow
              label="Screenshots"
              ratio={readiness.thumbRatio}
              detail={
                readiness.expectedThumbCount > 0
                  ? `${readiness.thumbCount} / ~${readiness.expectedThumbCount} frames · ${formatDuration(readiness.thumbCoveredSeconds)} covered`
                  : "Waiting for media…"
              }
            />
            <ProgressRow
              label="Transcript"
              ratio={readiness.transcriptRatio}
              detail={
                readiness.recordedSeconds > 0
                  ? `${formatDuration(readiness.transcribedSeconds)} / ${formatDuration(readiness.recordedSeconds)} transcribed`
                  : "Waiting for audio…"
              }
            />
          </div>

          <div className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-[#152015]">
            <div
              className="h-full rounded-full bg-[var(--color-accent)] transition-all duration-500 ease-out"
              style={{
                width: `${Math.max(6, Math.round(readiness.overallRatio * 100))}%`,
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
