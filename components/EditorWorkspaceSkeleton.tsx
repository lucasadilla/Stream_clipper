import { EditorHeader } from "@/components/layout/EditorHeader";
import { cn } from "@/lib/cn";
import type { SessionMode } from "@/lib/sessionMode";

function SkeletonBlock({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "clipper-skeleton overflow-hidden rounded bg-white/[0.055]",
        className
      )}
      aria-hidden="true"
    />
  );
}

export function EditorWorkspaceSkeletonBody({
  mode,
}: {
  mode: SessionMode;
}) {
  if (mode === "agent") {
    return (
      <div className="min-h-0 flex-1 overflow-hidden px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto w-full max-w-[96rem] space-y-6">
          <div className="flex min-h-24 items-end justify-between gap-8 border-b border-white/[0.08] pb-5">
            <div className="space-y-3">
              <SkeletonBlock className="h-2.5 w-24" />
              <SkeletonBlock className="h-8 w-52" />
              <SkeletonBlock className="h-3 w-80 max-w-[65vw]" />
            </div>
            <SkeletonBlock className="hidden h-10 w-72 sm:block" />
          </div>
          <div
            className="grid justify-center gap-4"
            style={{ gridTemplateColumns: "repeat(auto-fit, 16rem)" }}
          >
            {Array.from({ length: 4 }, (_, index) => (
              <div
                key={index}
                className="overflow-hidden rounded-lg border border-white/[0.08] bg-[#0d0f12]"
              >
                <SkeletonBlock className="aspect-[9/16] w-full rounded-none" />
                <div className="h-[9.75rem] space-y-3 p-4">
                  <SkeletonBlock className="h-4 w-4/5" />
                  <SkeletonBlock className="h-3 w-full" />
                  <SkeletonBlock className="h-3 w-2/3" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex h-[54%] min-h-52 shrink-0 items-center justify-center border-b border-[var(--color-card-border)] bg-[#020302] p-5">
        <SkeletonBlock className="aspect-video h-[min(90%,34rem)] max-w-[82%] rounded-md bg-white/[0.045]" />
      </div>
      <div className="h-1.5 shrink-0 bg-[#0a100a]" />
      <div className="min-h-0 flex-1 border-t border-[var(--color-card-border)] bg-[#050705] p-3">
        <div className="mb-3 flex items-center justify-between">
          <SkeletonBlock className="h-7 w-60" />
          <SkeletonBlock className="h-7 w-32" />
        </div>
        <SkeletonBlock className="mb-2 h-5 w-full rounded-none" />
        <div className="space-y-2">
          <SkeletonBlock className="h-12 w-full rounded-sm" />
          <SkeletonBlock className="h-8 w-full rounded-sm" />
          <SkeletonBlock className="h-8 w-3/4 rounded-sm" />
        </div>
      </div>
    </div>
  );
}

export function EditorWorkspaceSkeleton({
  mode = "timeline",
  title,
  modeSwitching,
  onModeChange,
}: {
  mode?: SessionMode;
  title?: string | null;
  modeSwitching?: boolean;
  onModeChange?: (mode: SessionMode) => void;
}) {
  return (
    <div
      className={cn(
        "editor-shell flex h-screen flex-col overflow-hidden bg-[var(--color-background)]",
        mode === "agent" && "agent-shell bg-[#07090b]"
      )}
      aria-busy="true"
      aria-label={mode === "agent" ? "Loading Agent Mode" : "Loading timeline"}
      role="status"
    >
      <EditorHeader
        title={title ?? (mode === "agent" ? "Agent" : "Editor")}
        mode={mode}
        modeSwitching={modeSwitching}
        onModeChange={onModeChange}
        compact={mode === "timeline"}
      />
      <EditorWorkspaceSkeletonBody mode={mode} />
      <span className="sr-only">Loading editor</span>
    </div>
  );
}
