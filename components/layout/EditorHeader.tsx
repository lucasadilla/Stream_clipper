import Link from "next/link";
import { SiteLogo } from "@/components/layout/SiteLogo";
import { cn } from "@/lib/cn";

interface EditorHeaderProps {
  title?: string | null;
  storageLabel?: string;
  isLive?: boolean;
  recordedSeconds?: number;
  deleting?: boolean;
  onDelete?: () => void;
  compact?: boolean;
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
  compact = false,
}: EditorHeaderProps) {
  return (
    <header className="editor-header shrink-0 border-b border-[#21301f] bg-[#020302]">
      <div
        className={cn(
          "mx-auto flex w-full max-w-[1440px] items-center justify-between px-4 sm:px-6 lg:px-8",
          compact
            ? "h-16 gap-3 sm:h-[4.5rem] sm:gap-5"
            : "h-[var(--site-header-height)] gap-4"
        )}
      >
        <div className={cn("flex min-w-0 items-center", compact ? "gap-3 sm:gap-4" : "gap-4 sm:gap-5")}>
          <SiteLogo
            className={cn(
              compact &&
                "[&_.site-logo-mark]:h-9 [&_.site-logo-mark]:w-12"
            )}
          />
          <div className={cn("hidden w-px bg-[#243524] sm:block", compact ? "h-8" : "h-10")} />
          <div className="min-w-0">
            <p className={cn("hidden font-medium uppercase tracking-[0.16em] text-white/45 sm:block", compact ? "text-[9px]" : "text-[11px]")}>
              Editor
            </p>
            <h1 className={cn("truncate font-[var(--font-display)] leading-tight text-[#F1EFE7]", compact ? "text-base sm:text-lg" : "text-lg sm:text-xl")}>
              {title ?? "Untitled session"}
            </h1>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          {storageLabel && storageLabel !== "0 B" && (
            <span className={cn("hidden rounded-full border border-[#243524] bg-[#0c100c] font-mono text-xs text-white/55 lg:inline", compact ? "px-3 py-1.5" : "px-4 py-2")}>
              {storageLabel}
            </span>
          )}

          {isLive && (
            <span className={cn("inline-flex items-center gap-2 rounded-full border border-red-500/35 bg-red-500/10 font-mono font-semibold text-[#ff8f8f]", compact ? "h-9 px-3 text-xs sm:h-10 sm:px-4" : "h-12 px-4 text-sm sm:h-14 sm:px-5")}>
              <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse" />
              LIVE {formatLiveClock(recordedSeconds)}
            </span>
          )}

          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              disabled={deleting}
              className={cn(
                "hidden items-center rounded-lg border border-[#30462d] bg-[#070a07] text-sm font-semibold text-white/70 transition-colors hover:border-red-500/50 hover:text-red-400 disabled:opacity-50 sm:inline-flex",
                compact ? "h-10 px-4" : "h-12 px-5 sm:h-14 sm:px-6"
              )}
            >
              {deleting ? "Deleting…" : "Delete"}
            </button>
          )}

          <Link
            href="/"
            className={cn(
              "inline-flex items-center rounded-lg bg-[var(--color-accent)] text-sm font-semibold text-[#071006] transition-colors hover:bg-[var(--color-accent-hover)]",
              compact ? "h-9 px-4 sm:h-10 sm:px-5" : "h-12 px-5 sm:h-14 sm:px-7"
            )}
          >
            Home
          </Link>
        </div>
      </div>
    </header>
  );
}
