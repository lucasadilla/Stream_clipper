import Link from "next/link";
import { SiteLogo } from "@/components/layout/SiteLogo";

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
    <header className="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-[var(--color-card-border)] bg-[#020302] px-3 sm:px-4">
      <div className="flex min-w-0 items-center gap-3">
        <SiteLogo showText={false} />
        <div className="hidden h-4 w-px bg-[var(--color-card-border)] sm:block" />
        <h1 className="truncate text-xs font-semibold text-[var(--color-foreground)]/90">
          {title ?? "Editor"}
        </h1>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {storageLabel && storageLabel !== "0 B" && (
          <span className="hidden font-mono text-[10px] text-[var(--color-muted)] sm:inline">
            {storageLabel}
          </span>
        )}
        {onToggleChat && (
          <button
            type="button"
            onClick={onToggleChat}
            aria-pressed={chatVisible}
            className={`border px-2 py-1 text-[10px] uppercase tracking-[0.12em] transition-colors ${
              chatVisible
                ? "border-[var(--color-accent)]/50 text-[var(--color-accent)]"
                : "border-[var(--color-card-border)] text-[var(--color-muted)] hover:border-[var(--color-accent)]/40 hover:text-white"
            }`}
          >
            Chat
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            disabled={deleting}
            className="border border-[var(--color-card-border)] px-2 py-1 text-[10px] text-[var(--color-muted)] transition-colors hover:border-red-500/50 hover:text-red-400 disabled:opacity-50"
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        )}
        {isLive && (
          <span className="flex items-center gap-1.5 font-mono text-[10px] text-[#ff6b6b]">
            <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
            LIVE {Math.floor(recordedSeconds)}s
          </span>
        )}
        <Link
          href="/"
          className="hidden text-[10px] uppercase tracking-[0.12em] text-[var(--color-muted)] transition-colors hover:text-white sm:inline"
        >
          Home
        </Link>
      </div>
    </header>
  );
}
