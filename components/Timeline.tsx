"use client";

import { formatSeconds } from "@/lib/time";
import { cn } from "@/lib/cn";

export type TimelineMarkerType =
  | "chat_window"
  | "transcript"
  | "audio"
  | "visual"
  | "clip";

export interface TimelineMarker {
  id: string;
  type: TimelineMarkerType;
  startTimeSeconds: number;
  endTimeSeconds?: number;
  label: string;
  score?: number;
}

interface TimelineProps {
  markers: TimelineMarker[];
  durationSeconds: number;
  currentTime?: number;
  onSeek: (seconds: number) => void;
}

const TYPE_COLORS: Record<TimelineMarkerType, string> = {
  chat_window: "bg-purple-500",
  transcript: "bg-blue-500",
  audio: "bg-orange-500",
  visual: "bg-green-500",
  clip: "bg-pink-500",
};

const TYPE_LABELS: Record<TimelineMarkerType, string> = {
  chat_window: "Chat",
  transcript: "Transcript",
  audio: "Audio",
  visual: "Visual",
  clip: "Clip",
};

export function Timeline({
  markers,
  durationSeconds,
  currentTime = 0,
  onSeek,
}: TimelineProps) {
  const maxTime = Math.max(durationSeconds, 1);
  const playheadPercent = (currentTime / maxTime) * 100;

  return (
    <div className="rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)] p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-sm">Timeline</h3>
        <div className="flex gap-3 text-[10px]">
          {(Object.keys(TYPE_COLORS) as TimelineMarkerType[]).map((type) => (
            <span key={type} className="flex items-center gap-1 text-[var(--color-muted)]">
              <span className={cn("w-2 h-2 rounded-full", TYPE_COLORS[type])} />
              {TYPE_LABELS[type]}
            </span>
          ))}
        </div>
      </div>

      {markers.length === 0 ? (
        <p className="text-xs text-[var(--color-muted)] text-center py-6">
          No events detected yet. Start chat tracking or process your source video.
        </p>
      ) : (
        <div className="relative h-12 bg-[var(--color-background)] rounded-lg overflow-hidden">
          {/* Playhead */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-white z-10"
            style={{ left: `${playheadPercent}%` }}
          />

          {markers.map((marker) => {
            const left = (marker.startTimeSeconds / maxTime) * 100;
            const width = marker.endTimeSeconds
              ? ((marker.endTimeSeconds - marker.startTimeSeconds) / maxTime) * 100
              : 0.5;

            return (
              <button
                key={marker.id}
                title={`${marker.label} (${formatSeconds(marker.startTimeSeconds)})`}
                onClick={() => onSeek(marker.startTimeSeconds)}
                className={cn(
                  "absolute top-1 bottom-1 rounded-sm opacity-80 hover:opacity-100 transition-opacity",
                  TYPE_COLORS[marker.type],
                  marker.endTimeSeconds ? "min-w-[4px]" : "w-1.5"
                )}
                style={{
                  left: `${left}%`,
                  width: marker.endTimeSeconds ? `${Math.max(width, 0.5)}%` : undefined,
                }}
              />
            );
          })}
        </div>
      )}

      <div className="flex justify-between text-[10px] text-[var(--color-muted)] mt-1">
        <span>0:00</span>
        <span>{formatSeconds(maxTime)}</span>
      </div>
    </div>
  );
}
