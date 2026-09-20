import Link from "next/link";
import { Clapperboard, HardDrive, Home, Sparkles, Trash2 } from "lucide-react";
import { SiteLogo } from "@/components/layout/SiteLogo";
import { cn } from "@/lib/cn";
import type { SessionMode } from "@/lib/sessionMode";

interface EditorHeaderProps {
  title?: string | null;
  storageLabel?: string;
  isLive?: boolean;
  recordedSeconds?: number;
  deleting?: boolean;
  onDelete?: () => void;
  compact?: boolean;
  mode?: "agent" | "timeline" | "editor";
  modeSwitching?: boolean;
  onModeChange?: (mode: SessionMode) => void;
}

function formatLiveClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function EditorHeader({
  title,
  storageLabel,
  isLive,
  recordedSeconds = 0,
  deleting,
  onDelete,
  mode = "editor",
  modeSwitching = false,
  onModeChange,
}: EditorHeaderProps) {
  const canSwitchModes = mode !== "editor" && Boolean(onModeChange);

  return (
    <header
      className={cn(
        "editor-header relative z-30 shrink-0 border-b border-white/[0.08] backdrop-blur-xl",
        mode === "agent" ? "bg-[#0a0b0d]/95" : "bg-[#030403]/95"
      )}
    >
      <div
        className="grid h-14 w-full items-center gap-2 px-3 sm:h-[4.5rem] sm:gap-4 sm:px-5 lg:px-6"
        style={{ gridTemplateColumns: "auto minmax(0, 1fr) auto" }}
      >
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <SiteLogo
            showText={false}
            className="[&_.site-logo-mark]:h-8 [&_.site-logo-mark]:w-10 sm:[&_.site-logo-mark]:h-9 sm:[&_.site-logo-mark]:w-11"
          />
        </div>

        <div className="flex min-w-0 items-center gap-3 px-1 sm:px-4">
          <h1
            className={cn(
              "min-w-0 flex-1 truncate text-xs font-medium text-[#F1EFE7] sm:text-sm",
              canSwitchModes && "hidden lg:block"
            )}
          >
            {title ?? "Untitled session"}
          </h1>

          {canSwitchModes && (
            <div
              className="mx-auto grid h-9 shrink-0 grid-cols-2 rounded-md border border-white/10 bg-black/35 p-1 shadow-inner shadow-black/30"
              aria-label="Editor mode"
            >
              {([
                { id: "agent" as const, label: "Agent", Icon: Sparkles },
                { id: "timeline" as const, label: "Timeline", Icon: Clapperboard },
              ]).map(({ id, label, Icon }) => {
                const active = mode === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => onModeChange?.(id)}
                    disabled={active || modeSwitching}
                    aria-pressed={active}
                    className={cn(
                      "flex h-7 min-w-[2.25rem] items-center justify-center gap-1.5 rounded-sm px-2 text-[10px] font-semibold transition-[background-color,color,box-shadow,transform] duration-200 sm:min-w-[5.25rem] sm:px-3 sm:text-[11px]",
                      active
                        ? "bg-[#95ff00] text-[#0b0d0c] shadow-[0_3px_12px_rgba(149,255,0,0.18)]"
                        : "text-white/50 hover:bg-white/[0.06] hover:text-white",
                      modeSwitching && "cursor-wait opacity-70"
                    )}
                    title={`${label} mode`}
                  >
                    <Icon className={cn("h-3.5 w-3.5", modeSwitching && active && "animate-pulse")} />
                    <span className="hidden sm:inline">{label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-1.5 sm:gap-2">
          {storageLabel && storageLabel !== "0 B" && (
            <span className="hidden h-8 items-center gap-1.5 border-r border-white/10 pr-3 font-mono text-[10px] text-white/45 lg:flex">
              <HardDrive className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{storageLabel}</span>
            </span>
          )}

          {isLive && (
            <span className="inline-flex h-8 items-center gap-1.5 rounded border border-red-400/25 bg-red-500/[0.08] px-2 font-mono text-[10px] font-semibold text-[#ff9c9c] sm:px-2.5">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-red-400" />
              </span>
              <span className="hidden sm:block">LIVE</span>
              {formatLiveClock(recordedSeconds)}
            </span>
          )}

          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              disabled={deleting}
              className="hidden h-8 w-8 place-items-center rounded border border-white/[0.08] text-white/45 transition-colors hover:border-red-400/30 hover:bg-red-500/[0.08] hover:text-red-300 disabled:cursor-wait disabled:opacity-40 sm:grid"
              aria-label={deleting ? "Deleting session" : "Delete session"}
              title={deleting ? "Deleting session" : "Delete session"}
            >
              <Trash2 className={cn("h-3.5 w-3.5", deleting && "animate-pulse")} />
            </button>
          )}

          <Link
            href="/"
            className="grid h-8 w-8 place-items-center rounded border border-white/[0.08] bg-white/[0.025] text-white/65 transition-colors hover:border-[var(--color-accent)]/35 hover:bg-[var(--color-accent)]/[0.07] hover:text-[var(--color-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
            aria-label="Go to home"
            title="Home"
          >
            <Home className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </header>
  );
}
