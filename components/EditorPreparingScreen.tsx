"use client";

import { EditorHeader } from "@/components/layout/EditorHeader";
import { formatDuration } from "@/lib/time";
import {
  EDITOR_READY_RATIO,
  type EditorReadiness,
} from "@/lib/editorReadiness";
import { cn } from "@/lib/cn";
import type { SessionMode } from "@/lib/sessionMode";
import { OperationProgress } from "@/components/ui/operation-progress";
import { EditorWorkspaceSkeletonBody } from "@/components/EditorWorkspaceSkeleton";

function ProgressRow({
  label,
  ratio,
  detail,
  measurable,
}: {
  label: string;
  ratio: number;
  detail: string;
  measurable: boolean;
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
          {measurable ? `${pct}%` : "Starting"}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[#152015]">
        {measurable ? (
          <div
            className={cn(
              "h-full rounded-full transition-all duration-500 ease-out",
              met
                ? "bg-[var(--color-accent)]"
                : "bg-[var(--color-accent)]/70 shadow-[0_0_14px_rgba(149,255,0,0.35)]"
            )}
            style={{ width: `${Math.max(4, pct)}%` }}
          />
        ) : (
          <div className="h-full w-2/5 animate-[agent-indeterminate_1.35s_ease-in-out_infinite] rounded-full bg-[var(--color-accent)]/70 motion-reduce:w-1/3 motion-reduce:animate-none" />
        )}
      </div>
      <p className="text-[10px] leading-4 text-[var(--color-muted)]">{detail}</p>
    </div>
  );
}

export function EditorPreparingScreen({
  title = "Editor",
  readiness,
  modeSwitching,
  onModeChange,
}: {
  title?: string;
  readiness: EditorReadiness;
  modeSwitching?: boolean;
  onModeChange?: (mode: SessionMode) => void;
}) {
  const targetPct = Math.round(EDITOR_READY_RATIO * 100);
  return (
    <div className="editor-shell flex h-screen flex-col overflow-hidden bg-[var(--color-background)]">
      <EditorHeader
        title={title}
        mode="timeline"
        modeSwitching={modeSwitching}
        onModeChange={onModeChange}
        compact
      />
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <EditorWorkspaceSkeletonBody mode="timeline" />
        <div className="absolute inset-0 flex items-center justify-center bg-[#020302]/72 px-6 py-10 backdrop-blur-[2px]">
          <div className="flex w-full max-w-md flex-col items-center gap-7 rounded-xl border border-white/[0.09] bg-[#050705]/95 p-5 text-center shadow-[0_28px_80px_rgba(0,0,0,0.62)] sm:p-6">
            <div className="w-full space-y-2">
              <OperationProgress
                title={readiness.statusMessage}
                detail={readiness.detailMessage}
                progress={
                  readiness.recordedSeconds > 0
                    ? readiness.overallRatio * 100
                    : null
                }
                stages={
                  readiness.recordedSeconds > 0
                    ? []
                    : [
                        "Fetching stream details…",
                        "Preparing source media…",
                        "Waiting for the first playable frames…",
                      ]
                }
              />
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
                measurable={readiness.expectedThumbCount > 0}
              />
              <ProgressRow
                label="Transcript"
                ratio={readiness.transcriptRatio}
                detail={
                  readiness.recordedSeconds > 0
                    ? `${formatDuration(readiness.transcribedSeconds)} / ${formatDuration(readiness.recordedSeconds)} transcribed`
                    : "Waiting for audio…"
                }
                measurable={readiness.recordedSeconds > 0}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
