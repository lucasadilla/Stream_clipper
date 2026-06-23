"use client";

interface StreamMetadata {
  title?: string | null;
  description?: string | null;
  channelTitle?: string | null;
  thumbnailUrl?: string | null;
  liveStatus?: string | null;
  actualStartTime?: string | null;
  scheduledStartTime?: string | null;
  concurrentViewers?: number | null;
  activeLiveChatId?: string | null;
  youtubeVideoId?: string;
}

interface StreamMetadataCardProps {
  session: StreamMetadata;
}

export function StreamMetadataCard({ session }: StreamMetadataCardProps) {
  return (
    <div className="rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)] overflow-hidden">
      {session.thumbnailUrl && (
        <img
          src={session.thumbnailUrl}
          alt={session.title ?? "Stream thumbnail"}
          className="w-full aspect-video object-cover"
        />
      )}
      <div className="p-4 space-y-3">
        <h2 className="font-semibold text-sm leading-snug line-clamp-2">
          {session.title ?? "Untitled stream"}
        </h2>
        <p className="text-xs text-[var(--color-muted)]">
          {session.channelTitle ?? "Unknown channel"}
        </p>

        <div className="space-y-1.5 text-xs">
          {session.liveStatus && (
            <Row label="Status" value={session.liveStatus} highlight />
          )}
          {session.concurrentViewers != null && (
            <Row label="Viewers" value={session.concurrentViewers.toLocaleString()} />
          )}
          {session.actualStartTime && (
            <Row
              label="Started"
              value={new Date(session.actualStartTime).toLocaleString()}
            />
          )}
          {session.scheduledStartTime && (
            <Row
              label="Scheduled"
              value={new Date(session.scheduledStartTime).toLocaleString()}
            />
          )}
          {session.activeLiveChatId && (
            <Row label="Live chat" value="Available" highlight />
          )}
        </div>

        {session.description && (
          <p className="text-xs text-[var(--color-muted)] line-clamp-4 pt-2 border-t border-[var(--color-card-border)]">
            {session.description}
          </p>
        )}
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-[var(--color-muted)]">{label}</span>
      <span
        className={
          highlight ? "text-[var(--color-success)] font-medium" : "text-right"
        }
      >
        {value}
      </span>
    </div>
  );
}
