"use client";

import { useState } from "react";
import { triggerFileDownload } from "@/lib/clientDownload";
import { clipDownloadUrl } from "@/lib/downloadUrls";
import { formatSeconds, formatDuration } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { TimelineMarker } from "@/components/Timeline";

interface TranscriptItem {
  id: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  text: string;
}

interface ClipPickerProps {
  sessionId: string;
  currentTime: number;
  recordedSeconds: number;
  isLive: boolean;
  markers: TimelineMarker[];
  transcripts: TranscriptItem[];
  onSeek: (seconds: number) => void;
  onClipCreated?: () => void;
}

export function ClipPicker({
  sessionId,
  currentTime,
  recordedSeconds,
  isLive,
  markers,
  transcripts,
  onSeek,
  onClipCreated,
}: ClipPickerProps) {
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(30);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canRender = true;

  async function createClip(renderAfter = false) {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/clips`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title || `Clip ${formatSeconds(start)}`,
          startTimeSeconds: start,
          endTimeSeconds: end,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create clip");

      onClipCreated?.();

      if (renderAfter && data.clip?.id) {
        const renderRes = await fetch(`/api/clips/${data.clip.id}/render`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ includeCaptions: false }),
        });
        const renderData = await renderRes.json();
        if (!renderRes.ok) {
          throw new Error(renderData.error ?? "Render failed");
        }
        const url = renderData.downloadUrl ?? clipDownloadUrl(data.clip.id);
        await triggerFileDownload(url, `${data.clip.title || "short"}.mp4`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  function pickMoment(marker: TimelineMarker) {
    const s = marker.startTimeSeconds;
    const e = marker.endTimeSeconds ?? s + 30;
    setStart(s);
    setEnd(Math.min(e, s + 60));
    setTitle(marker.label.slice(0, 60));
    onSeek(s);
  }

  function pickTranscript(t: TranscriptItem) {
    setStart(t.startTimeSeconds);
    setEnd(t.endTimeSeconds);
    setTitle(t.text.slice(0, 60));
    onSeek(t.startTimeSeconds);
  }

  const topMoments = [...markers]
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 8);

  return (
    <div className="rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)] p-4 space-y-4">
      <div>
        <h3 className="font-semibold text-sm">Make a Clip</h3>
        <p className="text-[10px] text-[var(--color-muted)] mt-1">
          Pick timestamps, a moment, or transcript — render while the stream records.
          {isLive && recordedSeconds > 0 && (
            <> Recorded so far: {formatSeconds(recordedSeconds)}</>
          )}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <TimeField label="Start" value={start} onChange={setStart} />
        <TimeField label="End" value={end} onChange={setEnd} />
      </div>

      <div className="flex flex-wrap gap-2">
        <SmallButton onClick={() => setStart(Math.floor(currentTime))}>
          Start = player
        </SmallButton>
        <SmallButton onClick={() => setEnd(Math.floor(currentTime))}>
          End = player
        </SmallButton>
        <SmallButton
          onClick={() => {
            setStart(Math.floor(currentTime));
            setEnd(Math.floor(currentTime) + 30);
          }}
        >
          Last 30s from player
        </SmallButton>
      </div>

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Clip title (optional)"
        className="w-full text-xs rounded-lg border border-[var(--color-card-border)] bg-[var(--color-background)] px-3 py-2 focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
      />

      <p className="text-[10px] text-[var(--color-muted)]">
        Duration: {formatDuration(end - start)}
        {!canRender && isLive && (
          <span className="text-[var(--color-warning)] ml-2">
            Waiting for more recording…
          </span>
        )}
      </p>

      <div className="flex gap-2">
        <button
          onClick={() => createClip(false)}
          disabled={loading || end <= start}
          className={cn(
            "flex-1 text-xs py-2 rounded-lg border border-[var(--color-card-border)]",
            "hover:border-[var(--color-accent)] disabled:opacity-50"
          )}
        >
          Save clip
        </button>
        <button
          onClick={() => createClip(true)}
          disabled={loading || end <= start || !canRender}
          className={cn(
            "flex-1 text-xs py-2 rounded-lg font-medium",
            "bg-[var(--color-accent)] disabled:opacity-50"
          )}
        >
          {loading ? "…" : "Render Short"}
        </button>
      </div>

      {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}

      {topMoments.length > 0 && (
        <div>
          <h4 className="text-[10px] uppercase text-[var(--color-muted)] mb-2">
            Pick a moment
          </h4>
          <div className="space-y-1 max-h-28 overflow-y-auto">
            {topMoments.map((m) => (
              <button
                key={m.id}
                onClick={() => pickMoment(m)}
                className="w-full text-left text-xs p-2 rounded-lg bg-[var(--color-background)] hover:border-[var(--color-accent)] border border-transparent"
              >
                <span className="text-[var(--color-muted)]">
                  {formatSeconds(m.startTimeSeconds)} · {m.type}
                </span>
                <p className="truncate">{m.label}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {transcripts.length > 0 && (
        <div>
          <h4 className="text-[10px] uppercase text-[var(--color-muted)] mb-2">
            Pick from transcript
          </h4>
          <div className="space-y-1 max-h-28 overflow-y-auto">
            {transcripts.slice(-12).reverse().map((t) => (
              <button
                key={t.id}
                onClick={() => pickTranscript(t)}
                className="w-full text-left text-xs p-2 rounded-lg bg-[var(--color-background)] hover:border-[var(--color-accent)] border border-transparent"
              >
                <span className="text-[var(--color-muted)]">
                  {formatSeconds(t.startTimeSeconds)}
                </span>
                <p className="truncate">{t.text}</p>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TimeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="text-[10px] text-[var(--color-muted)]">
      {label}
      <input
        type="number"
        min={0}
        step={1}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="mt-1 w-full text-xs rounded-lg border border-[var(--color-card-border)] bg-[var(--color-background)] px-2 py-1.5"
      />
    </label>
  );
}

function SmallButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="text-[10px] px-2 py-1 rounded-full border border-[var(--color-card-border)] hover:border-[var(--color-accent)] text-[var(--color-muted)]"
    >
      {children}
    </button>
  );
}
