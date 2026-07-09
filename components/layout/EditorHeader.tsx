import Link from "next/link";
import { SiteLogo } from "@/components/layout/SiteLogo";

interface EditorHeaderProps {
  title?: string | null;
  storageLabel?: string;
  isLive?: boolean;
  recordedSeconds?: number;
  deleting?: boolean;
  onDelete?: () => void;
}

export function EditorHeader({
  title,
  storageLabel,
  isLive,
  recordedSeconds = 0,
  deleting,
  onDelete,
}: EditorHeaderProps) {
  return (
    <header className="shrink-0 border-b border-[var(--color-card-border)] bg-[#020302]/92 backdrop-blur-sm px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
      <div className="flex items-center gap-4 min-w-0">
        <SiteLogo showText={false} />
        <div className="h-5 w-px bg-[var(--color-card-border)] hidden sm:block" />
        <h1 className="text-sm font-semibold truncate text-[var(--color-foreground)]/90">
          {title ?? "Editor"}
        </h1>
      </div>

      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        {storageLabel && storageLabel !== "0 B" && (
          <span className="text-[10px] text-[var(--color-muted)] hidden sm:inline">
            {storageLabel} local
          </span>
        )}
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            disabled={deleting}
            className="text-[10px] sm:text-xs px-2.5 py-1 rounded-lg border border-[var(--color-card-border)] text-[var(--color-muted)] hover:border-red-500/50 hover:text-red-400 disabled:opacity-50 transition-colors"
          >
            {deleting ? "Deleting..." : "Delete & free space"}
          </button>
        )}
        {isLive && (
          <span className="text-[10px] sm:text-xs text-[#ff6b6b] flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            LIVE / {Math.floor(recordedSeconds)}s
          </span>
        )}
        <Link
          href="/"
          className="text-xs text-[var(--color-muted)] hover:text-white hidden sm:inline transition-colors"
        >
          Home
        </Link>
      </div>
    </header>
  );
}
