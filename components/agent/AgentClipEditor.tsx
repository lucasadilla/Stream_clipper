"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/cn";
import { formatSeconds } from "@/lib/time";
import { MIN_CLIP_SECONDS, MAX_CLIP_SECONDS } from "@/lib/clipConstants";
import {
  applyCaptionEdits,
  mergeCaptionEdit,
  type CaptionEditsMap,
} from "@/lib/captionEdits";
import { buildCaptionTrack, type CaptionCue } from "@/lib/captionTrack";
import { CaptionAppearancePanel } from "@/components/CaptionAppearancePanel";
import type { CaptionAppearance } from "@/lib/captionAppearance";
import type { ClipSuggestionData } from "@/components/ClipSuggestionCard";
import { fetchJson } from "@/lib/apiClient";

interface TranscriptChunk {
  id: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  text: string;
  rawJson?: unknown;
}

interface AgentClipEditorProps {
  sessionId: string;
  clip: ClipSuggestionData;
  playbackUrl: string | null;
  sourceDuration: number;
  includeCaptions: boolean;
  onIncludeCaptionsChange: (value: boolean) => void;
  captionAppearance: CaptionAppearance;
  onCaptionAppearanceChange: (value: CaptionAppearance) => void;
  onClipChange: (clip: ClipSuggestionData) => void;
}

export function AgentClipEditor({
  sessionId,
  clip,
  playbackUrl,
  sourceDuration,
  includeCaptions,
  onIncludeCaptionsChange,
  captionAppearance,
  onCaptionAppearanceChange,
  onClipChange,
}: AgentClipEditorProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [currentTime, setCurrentTime] = useState(clip.startTimeSeconds);
  const [dragging, setDragging] = useState<"start" | "end" | "playhead" | null>(
    null
  );
  const [chunks, setChunks] = useState<TranscriptChunk[]>([]);
  const [edits, setEdits] = useState<CaptionEditsMap>({});
  const [editingCueId, setEditingCueId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const startRef = useRef(clip.startTimeSeconds);
  const endRef = useRef(clip.endTimeSeconds);
  startRef.current = clip.startTimeSeconds;
  endRef.current = clip.endTimeSeconds;

  const maxTime = Math.max(sourceDuration, clip.endTimeSeconds, 1);
  // Zoom the trim bar to the clip neighborhood (Twitch-style), not the full VOD.
  const viewPad = Math.max(
    20,
    Math.min(90, (clip.endTimeSeconds - clip.startTimeSeconds) * 0.75)
  );
  const viewStart = Math.max(0, clip.startTimeSeconds - viewPad);
  const viewEnd = Math.min(maxTime, clip.endTimeSeconds + viewPad);
  const viewSpan = Math.max(1, viewEnd - viewStart);

  const toPct = useCallback(
    (t: number) => ((t - viewStart) / viewSpan) * 100,
    [viewStart, viewSpan]
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [tx, cap] = await Promise.all([
        fetchJson<{
          transcriptChunks?: TranscriptChunk[];
        }>(`/api/sessions/${sessionId}/transcribe`, { method: "POST" }),
        fetchJson<{ edits?: CaptionEditsMap }>(
          `/api/sessions/${sessionId}/captions`
        ),
      ]);
      if (cancelled) return;
      if (tx.ok && tx.data.transcriptChunks) {
        setChunks(tx.data.transcriptChunks);
      }
      if (cap.ok && cap.data.edits) {
        setEdits(cap.data.edits);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const cues = useMemo(() => {
    const track = buildCaptionTrack(chunks, "vertical");
    const applied = applyCaptionEdits(track, edits);
    return applied.filter(
      (c) =>
        c.endTimeSeconds > clip.startTimeSeconds &&
        c.startTimeSeconds < clip.endTimeSeconds
    );
  }, [chunks, edits, clip.startTimeSeconds, clip.endTimeSeconds]);

  const activeCue = useMemo(() => {
    return (
      cues.find(
        (c) =>
          currentTime >= c.startTimeSeconds && currentTime < c.endTimeSeconds
      ) ?? null
    );
  }, [cues, currentTime]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !playbackUrl) return;
    if (video.getAttribute("src") !== playbackUrl) {
      video.setAttribute("src", playbackUrl);
      video.load();
    }
    try {
      video.currentTime = clip.startTimeSeconds;
    } catch {
      // ignore
    }
  }, [playbackUrl, clip.id, clip.startTimeSeconds]);

  const commitRange = useCallback(
    async (start: number, end: number) => {
      let s = Math.max(0, Math.min(start, maxTime));
      let e = Math.max(0, Math.min(end, maxTime));
      if (e - s < MIN_CLIP_SECONDS) e = Math.min(s + MIN_CLIP_SECONDS, maxTime);
      if (e - s > MAX_CLIP_SECONDS) e = s + MAX_CLIP_SECONDS;
      if (e <= s) return;

      const { ok, data } = await fetchJson<{
        clip?: ClipSuggestionData;
        error?: string;
      }>(`/api/clips/${clip.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startTimeSeconds: s, endTimeSeconds: e }),
      });
      if (ok && data.clip) onClipChange(data.clip);
    },
    [clip.id, maxTime, onClipChange]
  );

  const timeFromClientX = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el) return clip.startTimeSeconds;
      const rect = el.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return viewStart + ratio * viewSpan;
    },
    [clip.startTimeSeconds, viewStart, viewSpan]
  );

  useEffect(() => {
    if (!dragging) return;
    const onMove = (event: PointerEvent) => {
      const t = timeFromClientX(event.clientX);
      if (dragging === "start") {
        const next = Math.min(t, endRef.current - MIN_CLIP_SECONDS);
        onClipChange({
          ...clip,
          startTimeSeconds: Math.max(0, next),
        });
      } else if (dragging === "end") {
        const next = Math.max(t, startRef.current + MIN_CLIP_SECONDS);
        onClipChange({
          ...clip,
          endTimeSeconds: Math.min(maxTime, next),
        });
      } else {
        const clamped = Math.max(
          startRef.current,
          Math.min(endRef.current, t)
        );
        setCurrentTime(clamped);
        const video = videoRef.current;
        if (video) {
          try {
            video.currentTime = clamped;
          } catch {
            // ignore
          }
        }
      }
    };
    const onUp = () => {
      const mode = dragging;
      setDragging(null);
      if (mode === "start" || mode === "end") {
        void commitRange(startRef.current, endRef.current);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragging, timeFromClientX, clip, onClipChange, commitRange, maxTime]);

  async function saveCueEdit(cue: CaptionCue) {
    const text = editText.trim();
    if (!text) return;
    const nextEdits = mergeCaptionEdit(edits, cue.id, { text });
    setEdits(nextEdits);
    setEditingCueId(null);
    await fetchJson(`/api/sessions/${sessionId}/captions`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cueId: cue.id, text }),
    });
  }

  const startPct = toPct(clip.startTimeSeconds);
  const endPct = toPct(clip.endTimeSeconds);
  const playPct = toPct(
    Math.max(viewStart, Math.min(viewEnd, currentTime))
  );

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{clip.title}</h2>
        <p className="text-xs text-[var(--color-muted)]">
          Drag the handles like a Twitch clip — then tweak captions if you want.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-[var(--color-card-border)] bg-black">
        <div className="relative mx-auto aspect-[9/16] max-h-[52vh] w-full max-w-sm bg-black">
          {playbackUrl ? (
            <video
              ref={videoRef}
              className="h-full w-full object-contain"
              playsInline
              controls
              onTimeUpdate={(e) => {
                const t = e.currentTarget.currentTime;
                setCurrentTime(t);
                if (t < clip.startTimeSeconds - 0.15) {
                  e.currentTarget.currentTime = clip.startTimeSeconds;
                } else if (t > clip.endTimeSeconds) {
                  e.currentTarget.pause();
                  e.currentTarget.currentTime = clip.endTimeSeconds;
                }
              }}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-[var(--color-muted)]">
              Waiting for local preview…
            </div>
          )}
          {includeCaptions && activeCue && (
            <div className="pointer-events-none absolute inset-x-3 bottom-10 text-center">
              <span className="inline-block rounded bg-black/70 px-2 py-1 text-sm font-semibold text-white">
                {activeCue.text}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-2 rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)] p-3">
        <div className="flex justify-between text-[11px] text-[var(--color-muted)]">
          <span>{formatSeconds(clip.startTimeSeconds)}</span>
          <span>
            {formatSeconds(clip.endTimeSeconds - clip.startTimeSeconds)} selected
          </span>
          <span>{formatSeconds(clip.endTimeSeconds)}</span>
        </div>
        <div
          ref={trackRef}
          className="relative h-10 cursor-pointer rounded bg-[#141814]"
          onPointerDown={(e) => {
            if ((e.target as HTMLElement).dataset.handle) return;
            setDragging("playhead");
            const t = timeFromClientX(e.clientX);
            const clamped = Math.max(
              clip.startTimeSeconds,
              Math.min(clip.endTimeSeconds, t)
            );
            setCurrentTime(clamped);
            const video = videoRef.current;
            if (video) {
              try {
                video.currentTime = clamped;
              } catch {
                // ignore
              }
            }
          }}
        >
          <div
            className="absolute inset-y-0 bg-[var(--color-accent)]/25"
            style={{ left: `${startPct}%`, width: `${Math.max(1, endPct - startPct)}%` }}
          />
          <div
            data-handle="start"
            className="absolute top-0 z-10 h-full w-3 -translate-x-1/2 cursor-ew-resize rounded-sm bg-[var(--color-accent)]"
            style={{ left: `${startPct}%` }}
            onPointerDown={(e) => {
              e.stopPropagation();
              setDragging("start");
            }}
          />
          <div
            data-handle="end"
            className="absolute top-0 z-10 h-full w-3 -translate-x-1/2 cursor-ew-resize rounded-sm bg-[var(--color-accent)]"
            style={{ left: `${endPct}%` }}
            onPointerDown={(e) => {
              e.stopPropagation();
              setDragging("end");
            }}
          />
          <div
            className="pointer-events-none absolute top-0 z-20 h-full w-0.5 bg-white"
            style={{ left: `${playPct}%` }}
          />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2 rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)] p-3">
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={includeCaptions}
              onChange={(e) => onIncludeCaptionsChange(e.target.checked)}
              className="accent-[var(--color-accent)]"
            />
            Burn captions into export
          </label>
          <CaptionAppearancePanel
            appearance={captionAppearance}
            onChange={onCaptionAppearanceChange}
            disabled={!includeCaptions}
          />
        </div>

        <div className="space-y-2 rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)] p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8f9b89]">
            Captions in range
          </p>
          {!includeCaptions ? (
            <p className="text-xs text-[var(--color-muted)]">
              Captions are off for this export.
            </p>
          ) : cues.length === 0 ? (
            <p className="text-xs text-[var(--color-muted)]">
              No caption cues in this range yet.
            </p>
          ) : (
            <ul className="max-h-56 space-y-2 overflow-y-auto">
              {cues.map((cue) => (
                <li
                  key={cue.id}
                  className={cn(
                    "rounded-lg border border-[var(--color-card-border)] p-2 text-xs",
                    activeCue?.id === cue.id && "border-[var(--color-accent)]"
                  )}
                >
                  <p className="mb-1 text-[10px] text-[var(--color-muted)]">
                    {formatSeconds(cue.startTimeSeconds)}–
                    {formatSeconds(cue.endTimeSeconds)}
                  </p>
                  {editingCueId === cue.id ? (
                    <div className="space-y-2">
                      <textarea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        className="w-full rounded border border-[var(--color-card-border)] bg-[#0a0c0a] p-2 text-xs"
                        rows={2}
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="rounded bg-[var(--color-accent)] px-2 py-1 text-[10px] font-semibold text-black"
                          onClick={() => void saveCueEdit(cue)}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          className="rounded px-2 py-1 text-[10px] text-[var(--color-muted)]"
                          onClick={() => setEditingCueId(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="w-full text-left"
                      onClick={() => {
                        setEditingCueId(cue.id);
                        setEditText(cue.text);
                      }}
                    >
                      {cue.text}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
