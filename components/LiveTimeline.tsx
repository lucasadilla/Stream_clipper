"use client";

import { useRef, useCallback, useState, useEffect, useLayoutEffect } from "react";
import { formatSeconds, formatDuration } from "@/lib/time";
import { LIVE_SEGMENT_SECONDS } from "@/lib/timelineConstants";
import { cn } from "@/lib/utils";
import type { LiveTimelineSegment } from "@/lib/timelineSegments";
import type { TimelineThumbnail } from "@/services/timelineThumbnailService";

export interface ClipSelection {
  start: number;
  end: number;
}

type DragMode = "range" | "start" | "end" | "move" | "scrub" | null;

interface LiveTimelineProps {
  sessionId: string;
  segments: LiveTimelineSegment[];
  thumbnails?: TimelineThumbnail[];
  durationSeconds: number;
  recordedSeconds: number;
  currentTime: number;
  isLive: boolean;
  selection: ClipSelection;
  onSelectionChange: (selection: ClipSelection) => void;
  onSeek: (seconds: number) => void;
  onScrub: (seconds: number) => void;
  onClipCreated?: () => void;
}

const MIN_CLIP_SECONDS = 3;
const TRACK_LABEL_W = 52;
const MIN_ZOOM = 1;
const MAX_ZOOM = 32;
const ZOOM_STEP = 1.35;

function normalizeZoom(zoom: number) {
  return zoom <= 1.02 ? MIN_ZOOM : Math.round(zoom * 100) / 100;
}

function clampScrollLeft(scroll: HTMLDivElement, left: number) {
  const max = Math.max(0, scroll.scrollWidth - scroll.clientWidth);
  return Math.min(max, Math.max(0, left));
}

function pct(time: number, max: number) {
  return Math.min(100, Math.max(0, (time / max) * 100));
}

function getTickStep(maxTime: number, zoom: number) {
  const effectiveSpan = maxTime / zoom;
  if (effectiveSpan > 3600) return 600;
  if (effectiveSpan > 1800) return 300;
  if (effectiveSpan > 600) return 60;
  if (effectiveSpan > 300) return 30;
  if (effectiveSpan > 120) return 10;
  if (effectiveSpan > 60) return 5;
  if (effectiveSpan > 20) return 2;
  return 1;
}

function snapTime(seconds: number, step = 1) {
  return Math.round(seconds / step) * step;
}

function clampSelection(start: number, end: number, maxTime: number): ClipSelection {
  let s = Math.max(0, Math.min(start, maxTime));
  let e = Math.max(0, Math.min(end, maxTime));
  if (e < s) [s, e] = [e, s];
  if (e - s < MIN_CLIP_SECONDS) {
    e = Math.min(s + MIN_CLIP_SECONDS, maxTime);
    if (e - s < MIN_CLIP_SECONDS) s = Math.max(0, e - MIN_CLIP_SECONDS);
  }
  return { start: s, end: e };
}

export function LiveTimeline({
  sessionId,
  segments,
  thumbnails = [],
  durationSeconds,
  recordedSeconds,
  currentTime,
  isLive,
  selection,
  onSelectionChange,
  onSeek,
  onScrub,
  onClipCreated,
}: LiveTimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const videoTrackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<DragMode>(null);
  const [rendering, setRendering] = useState<"native" | "vertical" | null>(null);
  const [clipTitle, setClipTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [viewportWidth, setViewportWidth] = useState(0);
  const dragOrigin = useRef({ x: 0, anchorTime: 0, start: 0, end: 0 });

  const maxTime = Math.max(
    durationSeconds,
    LIVE_SEGMENT_SECONDS,
    recordedSeconds + (isLive ? LIVE_SEGMENT_SECONDS : 0)
  );

  const trackContentWidth =
    viewportWidth > 0 ? viewportWidth * normalizeZoom(zoom) : 0;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    function measure() {
      const node = scrollRef.current;
      if (!node) return;
      setViewportWidth(Math.max(0, node.clientWidth - TRACK_LABEL_W));
    }

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const setZoomAroundTime = useCallback(
    (newZoom: number, anchorTime: number) => {
      const clamped = normalizeZoom(
        Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, newZoom))
      );
      setZoom(clamped);

      requestAnimationFrame(() => {
        const scroll = scrollRef.current;
        if (!scroll || viewportWidth <= 0 || maxTime <= 0) return;

        if (clamped <= MIN_ZOOM) {
          scroll.scrollLeft = 0;
          return;
        }

        const newWidth = viewportWidth * clamped;
        const anchorPx = (anchorTime / maxTime) * newWidth;
        const viewW = scroll.clientWidth - TRACK_LABEL_W;
        scroll.scrollLeft = clampScrollLeft(scroll, anchorPx - viewW / 2);
      });
    },
    [viewportWidth, maxTime]
  );

  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;

    if (zoom <= 1.02) {
      scroll.scrollLeft = 0;
      return;
    }

    scroll.scrollLeft = clampScrollLeft(scroll, scroll.scrollLeft);
  }, [zoom, trackContentWidth, viewportWidth]);

  const zoomIn = useCallback(() => {
    setZoomAroundTime(zoom * ZOOM_STEP, currentTime);
  }, [zoom, currentTime, setZoomAroundTime]);

  const zoomOut = useCallback(() => {
    if (zoom <= 1.02) {
      setZoom(MIN_ZOOM);
      if (scrollRef.current) scrollRef.current.scrollLeft = 0;
      return;
    }
    setZoomAroundTime(zoom / ZOOM_STEP, currentTime);
  }, [zoom, currentTime, setZoomAroundTime]);

  const zoomToFit = useCallback(() => {
    setZoom(MIN_ZOOM);
    requestAnimationFrame(() => {
      const scroll = scrollRef.current;
      if (scroll) scroll.scrollLeft = 0;
    });
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    function onWheel(e: WheelEvent) {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const rect = videoTrackRef.current?.getBoundingClientRect();
        let anchorTime = currentTime;
        if (rect && rect.width > 0) {
          const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
          anchorTime = ratio * maxTime;
        }
        if (e.deltaY < 0) {
          setZoomAroundTime(zoom * ZOOM_STEP, anchorTime);
        } else {
          setZoomAroundTime(zoom / ZOOM_STEP, anchorTime);
        }
        return;
      }

      const scroll = scrollRef.current;
      if (!scroll) return;
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        scroll.scrollLeft += e.deltaX;
        return;
      }
      if (e.shiftKey) {
        e.preventDefault();
        scroll.scrollLeft += e.deltaY;
      }
    }

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoom, maxTime, currentTime, setZoomAroundTime]);

  const timeFromRef = useCallback(
    (clientX: number, ref: React.RefObject<HTMLDivElement | null>) => {
      const el = ref.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return ratio * maxTime;
    },
    [maxTime]
  );

  const timeFromVideoTrack = useCallback(
    (clientX: number) => timeFromRef(clientX, videoTrackRef),
    [timeFromRef]
  );

  useEffect(() => {
    if (!dragging) return;

    function onMove(e: PointerEvent) {
      const t = snapTime(timeFromVideoTrack(e.clientX), 1);
      const origin = dragOrigin.current;

      if (dragging === "range") {
        const start = Math.min(origin.anchorTime, t);
        const end = Math.max(origin.anchorTime, t);
        onSelectionChange(clampSelection(start, end, maxTime));
      } else if (dragging === "start") {
        onSelectionChange(clampSelection(t, origin.end, maxTime));
      } else if (dragging === "end") {
        onSelectionChange(clampSelection(origin.start, t, maxTime));
      } else if (dragging === "move") {
        const dx = e.clientX - origin.x;
        const el = videoTrackRef.current;
        if (!el) return;
        const dt = (dx / el.getBoundingClientRect().width) * maxTime;
        const width = origin.end - origin.start;
        let start = origin.start + dt;
        start = Math.max(0, Math.min(start, maxTime - width));
        onSelectionChange({ start, end: start + width });
      } else if (dragging === "scrub") {
        const scrubT = snapTime(
          videoTrackRef.current
            ? timeFromVideoTrack(e.clientX)
            : timeFromRef(e.clientX, rulerRef),
          0.1
        );
        onScrub(scrubT);
      }
    }

    function onUp() {
      setDragging(null);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragging, maxTime, onSelectionChange, onScrub, timeFromRef, timeFromVideoTrack]);

  function beginDrag(mode: DragMode, e: React.PointerEvent, anchorTime?: number) {
    e.preventDefault();
    e.stopPropagation();
    dragOrigin.current = {
      x: e.clientX,
      anchorTime: anchorTime ?? selection.start,
      start: selection.start,
      end: selection.end,
    };
    setDragging(mode);
  }

  function handleVideoTrackPointerDown(e: React.PointerEvent) {
    if (dragging) return;
    const t = timeFromVideoTrack(e.clientX);
    beginDrag("range", e, t);
    onSelectionChange(clampSelection(t, t + MIN_CLIP_SECONDS, maxTime));
  }

  async function handleRenderClip(format: "native" | "vertical") {
    if (selection.end <= selection.start) return;
    setError(null);
    setRendering(format);
    try {
      const { saveAndRenderClip } = await import("@/lib/clipActions");
      await saveAndRenderClip(
        sessionId,
        selection,
        clipTitle || `Clip ${formatSeconds(selection.start)}`,
        format
      );
      onClipCreated?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Render failed");
    } finally {
      setRendering(null);
    }
  }

  function setInPoint() {
    onSelectionChange(
      clampSelection(
        currentTime,
        Math.max(selection.end, currentTime + MIN_CLIP_SECONDS),
        maxTime
      )
    );
  }

  function setOutPoint() {
    onSelectionChange(
      clampSelection(
        Math.min(selection.start, currentTime - MIN_CLIP_SECONDS),
        currentTime,
        maxTime
      )
    );
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
        return;
      if (e.key === "i" || e.key === "I") setInPoint();
      if (e.key === "o" || e.key === "O") setOutPoint();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const playheadPct = pct(currentTime, maxTime);
  const recordedPct = pct(recordedSeconds, maxTime);
  const selStartPct = pct(selection.start, maxTime);
  const selWidthPct = pct(selection.end - selection.start, maxTime);

  const tickStep = getTickStep(maxTime, zoom);
  const rulerTicks: number[] = [];
  for (let t = 0; t <= maxTime; t += tickStep) rulerTicks.push(t);

  const zoomLabel = zoom <= 1.02 ? "Fit" : `${Math.round(zoom * 100)}%`;
  const atMinZoom = zoom <= 1.02;

  return (
    <div className="h-full flex flex-col rounded-lg border border-[#2a2a2a] bg-[#141414] overflow-hidden">
      {/* Premiere-style toolbar */}
      <div className="shrink-0 flex flex-wrap items-center gap-2 px-3 py-2 border-b border-[#2a2a2a] bg-[#1a1a1a]">
        <div className="flex items-center gap-1">
          <ToolBtn onClick={setInPoint} title="Mark In (I)">
            [
          </ToolBtn>
          <ToolBtn onClick={setOutPoint} title="Mark Out (O)">
            ]
          </ToolBtn>
          <ToolBtn onClick={() => onSeek(selection.start)} title="Play In to Out">
            ▶
          </ToolBtn>
        </div>

        <input
          value={clipTitle}
          onChange={(e) => setClipTitle(e.target.value)}
          placeholder="Clip name"
          className="flex-1 min-w-[120px] max-w-[200px] text-xs bg-[#0d0d0d] border border-[#333] rounded px-2 py-1.5 focus:outline-none focus:border-[var(--color-accent)]"
        />

        <div className="font-mono text-xs text-[#ccc] tabular-nums">
          <span className="text-[var(--color-accent)]">{formatSeconds(selection.start)}</span>
          <span className="text-[#666] mx-1.5">—</span>
          <span className="text-[var(--color-accent)]">{formatSeconds(selection.end)}</span>
          <span className="text-[#666] ml-2">({formatDuration(selection.end - selection.start)})</span>
        </div>

        <div className="flex items-center gap-1 border-l border-[#333] pl-2 ml-1">
          <ToolBtn onClick={zoomOut} title="Zoom out" disabled={atMinZoom}>
            −
          </ToolBtn>
          <button
            type="button"
            onClick={zoomToFit}
            title="Zoom to fit"
            className="min-w-[44px] h-7 px-1.5 text-[10px] font-mono text-[#888] rounded hover:bg-[#333] hover:text-white"
          >
            {zoomLabel}
          </button>
          <ToolBtn onClick={zoomIn} title="Zoom in (Ctrl+scroll)" disabled={zoom >= MAX_ZOOM}>
            +
          </ToolBtn>
        </div>

        <div className="font-mono text-xs text-[#888] ml-auto">
          {formatSeconds(currentTime)}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => handleRenderClip("native")}
            disabled={
              rendering !== null || selection.end - selection.start < MIN_CLIP_SECONDS
            }
            title="Export original stream aspect ratio (16:9)"
            className={cn(
              "text-xs px-3 py-1.5 rounded font-semibold border",
              "border-[#444] bg-[#252525] hover:bg-[#333] text-white",
              "disabled:opacity-40"
            )}
          >
            {rendering === "native" ? "Exporting…" : "Native"}
          </button>
          <button
            type="button"
            onClick={() => handleRenderClip("vertical")}
            disabled={
              rendering !== null || selection.end - selection.start < MIN_CLIP_SECONDS
            }
            title="Export 9:16 vertical short"
            className={cn(
              "text-xs px-3 py-1.5 rounded font-semibold",
              "bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white",
              "disabled:opacity-40"
            )}
          >
            {rendering === "vertical" ? "Exporting…" : "Vertical"}
          </button>
        </div>
      </div>

      {error && (
        <p className="shrink-0 px-3 py-1.5 text-xs text-[var(--color-danger)] bg-[#1a1a1a] border-b border-[#2a2a2a]">
          {error}
        </p>
      )}

      {/* Timeline body */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden">
        <div
          className="flex h-full"
          style={
            viewportWidth > 0
              ? { width: TRACK_LABEL_W + trackContentWidth }
              : { minWidth: "100%" }
          }
        >
          {/* Track labels gutter — stays visible while scrolling */}
          <div
            className="sticky left-0 z-20 shrink-0 border-r border-[#2a2a2a] bg-[#1a1a1a] flex flex-col"
            style={{ width: TRACK_LABEL_W }}
          >
            <div className="h-7 border-b border-[#2a2a2a]" />
            <div className="h-[min(22vh,100px)] flex items-center justify-center border-b border-[#2a2a2a]">
              <span className="text-[10px] font-semibold text-[#888]">V1</span>
            </div>
          </div>

          {/* Tracks + ruler */}
          <div
            className="shrink-0 flex flex-col"
            style={{ width: trackContentWidth || "100%" }}
          >
            {/* Ruler */}
            <div
              ref={rulerRef}
              className="relative h-7 bg-[#1e1e1e] border-b border-[#2a2a2a] cursor-ew-resize shrink-0"
              onPointerDown={(e) => {
                const t = snapTime(timeFromRef(e.clientX, rulerRef), 0.1);
                onScrub(t);
                beginDrag("scrub", e);
              }}
            >
              {rulerTicks.map((t) => (
                <div
                  key={t}
                  className="absolute top-0 bottom-0"
                  style={{ left: `${pct(t, maxTime)}%` }}
                >
                  <div className="w-px h-2 bg-[#555] mt-auto" />
                  <span className="absolute top-0.5 left-1 text-[9px] text-[#777] font-mono whitespace-nowrap">
                    {formatSeconds(t)}
                  </span>
                </div>
              ))}
              <Playhead percent={playheadPct} tall onScrub={(e) => beginDrag("scrub", e)} />
            </div>

            {/* V1 Video track */}
            <div
              ref={videoTrackRef}
              className="relative h-[min(22vh,100px)] bg-[#0d0d0d] border-b border-[#2a2a2a] cursor-crosshair shrink-0"
              onPointerDown={handleVideoTrackPointerDown}
            >
              {/* Filmstrip */}
              <div className="absolute inset-0 pointer-events-none">
                {thumbnails.length > 0
                  ? thumbnails.map((thumb) => (
                      <div
                        key={thumb.startTimeSeconds}
                        className="absolute top-0 bottom-0 border-r border-[#000]/60 overflow-hidden"
                        style={{
                          left: `${pct(thumb.startTimeSeconds, maxTime)}%`,
                          width: `${Math.max(
                            pct(thumb.endTimeSeconds - thumb.startTimeSeconds, maxTime),
                            0.4
                          )}%`,
                        }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={thumb.url}
                          alt=""
                          className="w-full h-full object-cover"
                          draggable={false}
                        />
                      </div>
                    ))
                  : segments.map((seg) => (
                      <div
                        key={seg.id}
                        className={cn(
                          "absolute top-0 bottom-0 border-r border-[#333] bg-[#222]",
                          seg.isNew && "ring-1 ring-inset ring-[var(--color-success)]"
                        )}
                        style={{
                          left: `${pct(seg.startTimeSeconds, maxTime)}%`,
                          width: `${Math.max(
                            pct(seg.endTimeSeconds - seg.startTimeSeconds, maxTime),
                            0.4
                          )}%`,
                        }}
                      />
                    ))}
              </div>

              {/* Unrecorded region */}
              <div
                className="absolute inset-y-0 right-0 bg-[#0d0d0d]/80 pointer-events-none"
                style={{ left: `${recordedPct}%` }}
              />
              {isLive && recordedSeconds > 0 && (
                <div
                  className="absolute top-0 bottom-0 w-px bg-red-500/80 z-[2]"
                  style={{ left: `${recordedPct}%` }}
                />
              )}

              {/* Selection (Premiere-style yellow-ish highlight) */}
              <div
                className="absolute top-0 bottom-0 z-[5] border-2 border-[#e8b84a] bg-[#e8b84a]/15"
                style={{
                  left: `${selStartPct}%`,
                  width: `${Math.max(selWidthPct, 0.2)}%`,
                }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <div
                  className="absolute left-0 top-0 bottom-0 w-2 -ml-1 bg-[#e8b84a] cursor-ew-resize z-10"
                  onPointerDown={(e) => beginDrag("start", e)}
                />
                <div
                  className="absolute inset-x-2 inset-y-0 cursor-grab active:cursor-grabbing"
                  onPointerDown={(e) => beginDrag("move", e)}
                />
                <div
                  className="absolute right-0 top-0 bottom-0 w-2 -mr-1 bg-[#e8b84a] cursor-ew-resize z-10"
                  onPointerDown={(e) => beginDrag("end", e)}
                />
              </div>

              <Playhead percent={playheadPct} onScrub={(e) => beginDrag("scrub", e)} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Playhead({
  percent,
  tall,
  onScrub,
}: {
  percent: number;
  tall?: boolean;
  onScrub?: (e: React.PointerEvent) => void;
}) {
  return (
    <div className="absolute top-0 bottom-0 z-[30] pointer-events-none" style={{ left: `${percent}%` }}>
      <div
        className={cn(
          "absolute top-0 bottom-0 w-px bg-[#e8b84a] -translate-x-1/2 shadow-[0_0_4px_#e8b84a]",
          onScrub && "pointer-events-auto cursor-ew-resize"
        )}
        onPointerDown={onScrub}
      />
      <div
        className={cn(
          "absolute -translate-x-1/2 w-0 h-0",
          tall ? "-top-0" : "top-0",
          "border-l-[6px] border-r-[6px] border-t-[8px]",
          "border-l-transparent border-r-transparent border-t-[#e8b84a]",
          onScrub && "pointer-events-auto cursor-grab"
        )}
        onPointerDown={onScrub}
      />
    </div>
  );
}

function ToolBtn({
  children,
  onClick,
  title,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className="w-7 h-7 flex items-center justify-center text-xs text-[#aaa] rounded hover:bg-[#333] hover:text-white border border-transparent hover:border-[#444] disabled:opacity-30 disabled:pointer-events-none"
    >
      {children}
    </button>
  );
}
