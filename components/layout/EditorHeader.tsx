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
  chatVisible?: boolean;
  onToggleChat?: () => void;
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
  chatVisible,
  onToggleChat,
}: EditorHeaderProps) {
  return (
    <header className="editor-header shrink-0 border-b border-[#21301f] bg-[#020302]">
      <div className="mx-auto flex h-[var(--site-header-height)] w-full max-w-[1440px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-4 sm:gap-5">
          <SiteLogo />
          <div className="hidden h-10 w-px bg-[#243524] sm:block" />
          <div className="min-w-0">
            <p className="hidden text-[11px] font-medium uppercase tracking-[0.16em] text-white/45 sm:block">
              Editor
            </p>
            <h1 className="truncate font-[var(--font-display)] text-lg leading-tight text-[#F1EFE7] sm:text-xl">
              {title ?? "Untitled session"}
            </h1>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          {storageLabel && storageLabel !== "0 B" && (
            <span className="hidden rounded-full border border-[#243524] bg-[#0c100c] px-4 py-2 font-mono text-xs text-white/55 lg:inline">
              {storageLabel}
            </span>
          )}

          {isLive && (
            <span className="inline-flex h-12 items-center gap-2 rounded-full border border-red-500/35 bg-red-500/10 px-4 font-mono text-sm font-semibold text-[#ff8f8f] sm:h-14 sm:px-5">
              <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse" />
              LIVE {formatLiveClock(recordedSeconds)}
            </span>
          )}

          {onToggleChat && (
            <button
              type="button"
              onClick={onToggleChat}
              aria-pressed={chatVisible}
              className={cn(
                "hidden h-12 items-center rounded-lg border px-5 text-sm font-semibold transition-colors sm:inline-flex sm:h-14 sm:px-6",
                chatVisible
                  ? "border-[var(--color-accent)]/55 bg-[var(--color-accent)]/10 text-[var(--color-accent)]"
                  : "border-[#30462d] bg-[#070a07] text-white/75 hover:border-[var(--color-accent)]/50 hover:text-[var(--color-accent)]"
              )}
            >
              Chat
            </button>
          )}

          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              disabled={deleting}
              className="hidden h-12 items-center rounded-lg border border-[#30462d] bg-[#070a07] px-5 text-sm font-semibold text-white/70 transition-colors hover:border-red-500/50 hover:text-red-400 disabled:opacity-50 sm:inline-flex sm:h-14 sm:px-6"
            >
              {deleting ? "Deleting…" : "Delete"}
            </button>
          )}

          <Link
            href="/"
            className="inline-flex h-12 items-center rounded-lg bg-[var(--color-accent)] px-5 text-sm font-semibold text-[#071006] transition-colors hover:bg-[var(--color-accent-hover)] sm:h-14 sm:px-7"
          >
            Home
          </Link>
        </div>
      </div>
    </header>
  );
}
