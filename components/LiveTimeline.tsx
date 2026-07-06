"use client";

import { useRef, useCallback, useState, useEffect, useLayoutEffect, useMemo } from "react";
import { formatSeconds, formatDuration } from "@/lib/time";
import { LIVE_SEGMENT_SECONDS } from "@/lib/timelineConstants";
import { sanitizeDurationSeconds } from "@/lib/timelineBounds";
import { buildCaptionTrack, type TranscriptChunkInput, type CaptionCue } from "@/lib/captionTrack";
import type { CaptionAppearance } from "@/lib/captionAppearance";
import { applyCaptionEdits, clampCueRange, type CaptionEditsMap } from "@/lib/captionEdits";
import { CaptionTimelineTrack, type CaptionDragMode } from "@/components/CaptionTimelineTrack";
import { CaptionCueEditor } from "@/components/CaptionCueEditor";
import { RenderClipModal } from "@/components/RenderClipModal";
import { cn } from "@/lib/utils";
import type { LiveTimelineSegment } from "@/lib/timelineSegments";
import type { TimelineThumbnail } from "@/services/timelineThumbnailService";
import {
  formatHypeTooltip,
  type ChatHypeMoment,
  type HypeIntensity,
} from "@/lib/chatHypeTimeline";
import {
  formatAudioSpikeTooltip,
  waveformHasSignal,
  type AudioSpikeMarker,
  type AudioSpikeIntensity,
  type WaveformBucket,
} from "@/lib/audioSpikeTimeline";

export interface ClipSelection {
  start: number;
  end: number;
}

type DragMode =
  | "range"
  | "start"
  | "end"
  | "move"
  | "scrub"
  | CaptionDragMode
  | null;

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
  onPause: () => void;
  onScrub: (seconds: number) => void;
  onClipCreated?: () => void;
  includeCaptions?: boolean;
  captionChunks?: TranscriptChunkInput[];
  captionAppearance?: CaptionAppearance;
  captionEdits?: CaptionEditsMap;
  onCaptionEdit?: (
    cueId: string,
    patch: Partial<{
      text: string;
      startTimeSeconds: number;
      endTimeSeconds: number;
    }>
  ) => void;
  chatHypeMoments?: ChatHypeMoment[];
  showChatHypeTrack?: boolean;
  audioWaveform?: WaveformBucket[];
  audioSpikes?: AudioSpikeMarker[];
  showAudioLane?: boolean;
}

const VIDEO_TRACK_H = "min(22vh,100px)";
const AUDIO_TRACK_H = "min(14vh,72px)";
const HYPE_TRACK_H = "min(12vh,64px)";
const CAPTION_TRACK_H = "min(10vh,56px)";

import { MIN_CLIP_SECONDS, MAX_CLIP_SECONDS } from "@/lib/clipConstants";
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

function clampSelection(
  start: number,
  end: number,
  maxTime: number,
  opts?: { fixedEnd?: boolean }
): ClipSelection {
  let s = Math.max(0, Math.min(start, maxTime));
  let e = Math.max(0, Math.min(end, maxTime));
  if (e < s) [s, e] = [e, s];
  if (e - s < MIN_CLIP_SECONDS) {
    e = Math.min(s + MIN_CLIP_SECONDS, maxTime);
    if (e - s < MIN_CLIP_SECONDS) s = Math.max(0, e - MIN_CLIP_SECONDS);
  }
  if (e - s > MAX_CLIP_SECONDS) {
    if (opts?.fixedEnd) {
      s = Math.max(0, e - MAX_CLIP_SECONDS);
    } else {
      e = Math.min(maxTime, s + MAX_CLIP_SECONDS);
    }
  }
  return { start: s, end: e };
}

function hypeBarClass(intensity: HypeIntensity, isActive: boolean): string {
  if (isActive) {
    if (intensity === "high") {
      return "border-[#95FF00] bg-[#95FF00]/40 text-[#f0ffe0] z-[4]";
    }
    if (intensity === "medium") {
      return "border-orange-400 bg-orange-500/35 text-orange-50 z-[4]";
    }
    return "border-orange-500/70 bg-orange-600/25 text-orange-100 z-[4]";
  }
  if (intensity === "high") {
    return "border-[#95FF00]/60 bg-[#95FF00]/20 text-[#d4ffb8] hover:bg-[#95FF00]/30";
  }
  if (intensity === "medium") {
    return "border-orange-500/50 bg-orange-600/20 text-orange-200/90 hover:bg-orange-600/30";
  }
  return "border-orange-700/40 bg-orange-800/15 text-orange-300/70 hover:bg-orange-800/25";
}

function audioSpikeBarClass(
  intensity: AudioSpikeIntensity,
  isActive: boolean
): string {
  if (isActive) {
    if (intensity === "high") {
      return "border-[#00d4aa] bg-[#00d4aa]/45 text-[#e0fff8] z-[6] shadow-[0_0_8px_#00d4aa55]";
    }
    if (intensity === "medium") {
      return "border-cyan-400 bg-cyan-500/35 text-cyan-50 z-[5]";
    }
    return "border-cyan-600/60 bg-cyan-700/25 text-cyan-100 z-[4]";
  }
  if (intensity === "high") {
    return "border-[#00d4aa]/70 bg-[#00d4aa]/25 hover:bg-[#00d4aa]/35";
  }
  if (intensity === "medium") {
    return "border-cyan-500/50 bg-cyan-600/20 hover:bg-cyan-600/30";
  }
  return "border-cyan-700/40 bg-cyan-800/15 hover:bg-cyan-800/25";
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
  onPause,
  onScrub,
  onClipCreated,
  includeCaptions = true,
  captionChunks = [],
  captionAppearance,
  captionEdits = {},
  onCaptionEdit,
  chatHypeMoments = [],
  showChatHypeTrack = false,
  audioWaveform = [],
  audioSpikes = [],
  showAudioLane = false,
}: LiveTimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const videoTrackRef = useRef<HTMLDivElement>(null);
  const captionTrackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<DragMode>(null);
  const [selectedCaptionCueId, setSelectedCaptionCueId] = useState<string | null>(
    null
  );
  const [renderModalOpen, setRenderModalOpen] = useState(false);

  useEffect(() => {
    if (!renderModalOpen) return;
    setDragging(null);
    document.body.dataset.renderModalOpen = "true";
    return () => {
      delete document.body.dataset.renderModalOpen;
    };
  }, [renderModalOpen]);
  const [zoom, setZoom] = useState(1);
  const [viewportWidth, setViewportWidth] = useState(0);
  const dragOrigin = useRef({
    x: 0,
    anchorTime: 0,
    start: 0,
    end: 0,
    cueId: null as string | null,
    cueStart: 0,
    cueEnd: 0,
  });

  const maxTime = sanitizeDurationSeconds(
    Math.max(
      durationSeconds,
      LIVE_SEGMENT_SECONDS,
      recordedSeconds + (isLive ? LIVE_SEGMENT_SECONDS : 0)
    )
  );

  const trackContentWidth =
    viewportWidth > 0 ? viewportWidth * normalizeZoom(zoom) : 0;

  const baseCaptionCues = useMemo(
    () => (includeCaptions ? buildCaptionTrack(captionChunks, "native") : []),
    [captionChunks, includeCaptions]
  );

  const captionCues = useMemo(
    () => applyCaptionEdits(baseCaptionCues, captionEdits),
    [baseCaptionCues, captionEdits]
  );

  const selectedCaptionCue = useMemo(
    () => captionCues.find((c) => c.id === selectedCaptionCueId) ?? null,
    [captionCues, selectedCaptionCueId]
  );

  const showCaptionTrack = captionCues.length > 0;
  const showHypeTrack = showChatHypeTrack || chatHypeMoments.length > 0;
  const showAudioTrack =
    showAudioLane ||
    waveformHasSignal(audioWaveform) ||
    audioSpikes.length > 0;

  function handleHypeClick(moment: ChatHypeMoment) {
    const start = moment.startTimeSeconds;
    const end = Math.max(moment.endTimeSeconds, start + MIN_CLIP_SECONDS);
    onSeek(start);
    onSelectionChange(clampSelection(start, end, maxTime));
  }

  function handleAudioSpikeClick(marker: AudioSpikeMarker) {
    const start = marker.startTimeSeconds;
    const end = Math.max(marker.endTimeSeconds, start + MIN_CLIP_SECONDS);
    onSeek(start);
    onSelectionChange(clampSelection(start, end, maxTime));
  }

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
      const scroll = scrollRef.current;
      if (!scroll) return;

      // Trackpad horizontal swipe — scroll the timeline.
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        scroll.scrollLeft += e.deltaX;
        return;
      }

      // Shift+wheel — horizontal scroll (when zoomed in).
      if (e.shiftKey) {
        e.preventDefault();
        scroll.scrollLeft += e.deltaY;
        return;
      }

      // Wheel — zoom in/out around cursor position.
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

  const timeFromCaptionTrack = useCallback(
    (clientX: number) => timeFromRef(clientX, captionTrackRef),
    [timeFromRef]
  );

  useEffect(() => {
    if (!dragging) return;

    function onMove(e: PointerEvent) {
      const isCueDrag =
        dragging === "cue-start" ||
        dragging === "cue-end" ||
        dragging === "cue-move";
      const t = snapTime(
        isCueDrag ? timeFromCaptionTrack(e.clientX) : timeFromVideoTrack(e.clientX),
        isCueDrag ? 0.05 : 1
      );
      const origin = dragOrigin.current;

      if (dragging === "range") {
        const start = Math.min(origin.anchorTime, t);
        const end = Math.max(origin.anchorTime, t);
        onSelectionChange(clampSelection(start, end, maxTime));
      } else if (dragging === "start") {
        onSelectionChange(clampSelection(t, origin.end, maxTime, { fixedEnd: true }));
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
      } else if (dragging === "cue-start" && origin.cueId && onCaptionEdit) {
        const range = clampCueRange(t, origin.cueEnd, maxTime);
        onCaptionEdit(origin.cueId, range);
      } else if (dragging === "cue-end" && origin.cueId && onCaptionEdit) {
        const range = clampCueRange(origin.cueStart, t, maxTime);
        onCaptionEdit(origin.cueId, range);
      } else if (dragging === "cue-move" && origin.cueId && onCaptionEdit) {
        const el = captionTrackRef.current ?? videoTrackRef.current;
        if (!el) return;
        const width = origin.cueEnd - origin.cueStart;
        const dt = (e.clientX - origin.x) / el.getBoundingClientRect().width;
        const delta = dt * maxTime;
        let start = origin.cueStart + delta;
        start = Math.max(0, Math.min(start, maxTime - width));
        onCaptionEdit(origin.cueId, {
          startTimeSeconds: start,
          endTimeSeconds: start + width,
        });
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
  }, [
    dragging,
    maxTime,
    onSelectionChange,
    onScrub,
    onCaptionEdit,
    timeFromRef,
    timeFromVideoTrack,
    timeFromCaptionTrack,
  ]);

  function beginDrag(mode: DragMode, e: React.PointerEvent, anchorTime?: number) {
    e.preventDefault();
    e.stopPropagation();
    dragOrigin.current = {
      x: e.clientX,
      anchorTime: anchorTime ?? selection.start,
      start: selection.start,
      end: selection.end,
      cueId: null,
      cueStart: 0,
      cueEnd: 0,
    };
    setDragging(mode);
  }

  function beginCueDrag(
    mode: CaptionDragMode,
    e: React.PointerEvent,
    cue: CaptionCue
  ) {
    e.preventDefault();
    e.stopPropagation();
    setSelectedCaptionCueId(cue.id);
    dragOrigin.current = {
      x: e.clientX,
      anchorTime: cue.startTimeSeconds,
      start: selection.start,
      end: selection.end,
      cueId: cue.id,
      cueStart: cue.startTimeSeconds,
      cueEnd: cue.endTimeSeconds,
    };
    setDragging(mode);
  }

  function handleVideoTrackPointerDown(e: React.PointerEvent) {
    if (dragging) return;
    const t = timeFromVideoTrack(e.clientX);
    beginDrag("range", e, t);
    onSelectionChange(clampSelection(t, t + MIN_CLIP_SECONDS, maxTime));
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
  const maxTicks = 400;
  for (
    let t = 0;
    t <= maxTime && rulerTicks.length < maxTicks;
    t += tickStep
  ) {
    rulerTicks.push(t);
  }

  const zoomLabel = zoom <= 1.02 ? "Fit" : `${Math.round(zoom * 100)}%`;
  const atMinZoom = zoom <= 1.02;

  return (
    <>
    <div
      className={cn(
        "h-full flex flex-col rounded-lg border border-[#2a2a2a] bg-[#141414] overflow-hidden transition-opacity",
        renderModalOpen && "opacity-40 pointer-events-none select-none"
      )}
      aria-hidden={renderModalOpen}
    >
      {/* Premiere-style toolbar */}
      <div className="shrink-0 flex flex-wrap items-center gap-2 px-3 py-2 border-b border-[#2a2a2a] bg-[#1a1a1a]">
        <div className="flex items-center gap-1">
          <ToolBtn onClick={setInPoint} title="Mark In (I)">
            [
          </ToolBtn>
          <ToolBtn onClick={setOutPoint} title="Mark Out (O)">
            ]
          </ToolBtn>
          <ToolBtn onClick={() => onSeek(selection.start)} title="Play from In point">
            ▶
          </ToolBtn>
          <ToolBtn onClick={onPause} title="Pause">
            ⏸
          </ToolBtn>
        </div>

        <div className="font-mono text-xs text-[#ccc] tabular-nums">
          <span className="text-[var(--color-accent)]">{formatSeconds(selection.start)}</span>
          <span className="text-[#666] mx-1.5">—</span>
          <span className="text-[var(--color-accent)]">{formatSeconds(selection.end)}</span>
          <span className="text-[#666] ml-2">({formatDuration(selection.end - selection.start)})</span>
        </div>

        {chatHypeMoments.length > 0 && (
          <span
            className="text-[10px] font-medium text-orange-400 tabular-nums"
            title="Chat hype moments on timeline"
          >
            🔥 {chatHypeMoments.length}
          </span>
        )}

        {audioSpikes.length > 0 && (
          <span
            className="text-[10px] font-medium text-[#00d4aa] tabular-nums"
            title="Audio spikes on timeline"
          >
            🔊 {audioSpikes.length}
          </span>
        )}

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
          <ToolBtn onClick={zoomIn} title="Zoom in (scroll wheel)" disabled={zoom >= MAX_ZOOM}>
            +
          </ToolBtn>
        </div>

        <div className="font-mono text-xs text-[#888] ml-auto">
          {formatSeconds(currentTime)}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setRenderModalOpen(true)}
            disabled={
              selection.end - selection.start < MIN_CLIP_SECONDS ||
              selection.end - selection.start > MAX_CLIP_SECONDS
            }
            title={
              selection.end - selection.start > MAX_CLIP_SECONDS
                ? `Clip must be ${MAX_CLIP_SECONDS / 60} minutes or shorter`
                : "Render clip — pick aspect ratio, title, and export options"
            }
            className={cn(
              "text-xs px-4 py-1.5 rounded font-semibold",
              "bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white",
              "disabled:opacity-40"
            )}
          >
            Render
          </button>
        </div>
      </div>

      {selectedCaptionCue && onCaptionEdit && (
        <CaptionCueEditor
          cue={selectedCaptionCue}
          onSave={(text) => onCaptionEdit(selectedCaptionCue.id, { text })}
          onClose={() => setSelectedCaptionCueId(null)}
        />
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
            <div
              className="flex items-center justify-center border-b border-[#2a2a2a]"
              style={{ height: VIDEO_TRACK_H }}
            >
              <span className="text-[10px] font-semibold text-[#888]">V1</span>
            </div>
            {showAudioTrack && (
              <div
                className="flex items-center justify-center border-b border-[#2a2a2a]"
                style={{ height: AUDIO_TRACK_H }}
              >
                <span className="text-[10px] font-semibold text-[#00d4aa]">A1</span>
              </div>
            )}
            {showHypeTrack && (
              <div
                className="flex items-center justify-center border-b border-[#2a2a2a]"
                style={{ height: HYPE_TRACK_H }}
              >
                <span className="text-[10px] font-semibold text-orange-400">🔥</span>
              </div>
            )}
            {showCaptionTrack && (
              <div
                className="flex items-center justify-center border-b border-[#2a2a2a]"
                style={{ height: CAPTION_TRACK_H }}
              >
                <span className="text-[10px] font-semibold text-[#7eb8ff]">CC</span>
              </div>
            )}
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
              {!renderModalOpen && (
                <Playhead
                  percent={playheadPct}
                  tall
                  onScrub={(e) => beginDrag("scrub", e)}
                />
              )}
            </div>

            {/* Tracks stack — shared playhead spans video + captions */}
            <div className="relative shrink-0">
              {/* V1 Video track */}
              <div
                ref={videoTrackRef}
                className="relative bg-[#0d0d0d] border-b border-[#2a2a2a] cursor-crosshair"
                style={{ height: VIDEO_TRACK_H }}
                onPointerDown={handleVideoTrackPointerDown}
              >
              {/* Filmstrip */}
              <div className="absolute inset-0 pointer-events-none">
                {thumbnails.length > 0
                  ? thumbnails.map((thumb, index) => (
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
                          loading={index < 80 ? "eager" : "lazy"}
                          decoding="async"
                          fetchPriority={index < 20 ? "high" : "auto"}
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

            </div>

            {/* Audio loudness + spike lane */}
            {showAudioTrack && (
              <div
                className="relative bg-[#061210] border-b border-[#2a2a2a] shrink-0 overflow-hidden"
                style={{ height: AUDIO_TRACK_H }}
              >
                {audioWaveform.map((bucket, i) => (
                  <div
                    key={`wf-${i}`}
                    className="absolute bottom-0 bg-[#00d4aa]/35 pointer-events-none rounded-t-[1px]"
                    style={{
                      left: `${pct(bucket.startTimeSeconds, maxTime)}%`,
                      width: `${Math.max(
                        pct(
                          bucket.endTimeSeconds - bucket.startTimeSeconds,
                          maxTime
                        ),
                        0.12
                      )}%`,
                      height: `${Math.max(8, bucket.level * 92)}%`,
                    }}
                  />
                ))}

                {!waveformHasSignal(audioWaveform) && audioSpikes.length === 0 && (
                  <div className="absolute inset-0 flex items-center justify-center text-[9px] text-[#00d4aa]/35 pointer-events-none">
                    {isLive ? "Analyzing audio levels…" : "No audio spikes yet"}
                  </div>
                )}

                {audioSpikes.map((marker) => {
                  const isActive =
                    currentTime >= marker.startTimeSeconds &&
                    currentTime < marker.endTimeSeconds;
                  return (
                    <button
                      key={marker.id}
                      type="button"
                      title={formatAudioSpikeTooltip(marker)}
                      onClick={() => handleAudioSpikeClick(marker)}
                      className={cn(
                        "absolute top-0.5 bottom-0.5 rounded-sm border cursor-pointer",
                        "min-w-[3px] px-0",
                        audioSpikeBarClass(marker.intensity, isActive)
                      )}
                      style={{
                        left: `${pct(marker.startTimeSeconds, maxTime)}%`,
                        width: `${Math.max(
                          pct(
                            marker.endTimeSeconds - marker.startTimeSeconds,
                            maxTime
                          ),
                          marker.type === "volume_spike" ? 0.35 : 0.6
                        )}%`,
                      }}
                    />
                  );
                })}
              </div>
            )}

            {/* Chat hype track */}
            {showHypeTrack && (
              <div
                className="relative bg-[#120a08] border-b border-[#2a2a2a] shrink-0 overflow-hidden"
                style={{ height: HYPE_TRACK_H }}
              >
                {chatHypeMoments.length === 0 ? (
                  <div className="absolute inset-0 flex items-center justify-center text-[9px] text-orange-400/40 pointer-events-none">
                    {isLive ? "Watching chat for hype…" : "No hype moments yet"}
                  </div>
                ) : (
                  chatHypeMoments.map((moment) => {
                    const isActive =
                      currentTime >= moment.startTimeSeconds &&
                      currentTime < moment.endTimeSeconds;
                    return (
                      <button
                        key={moment.id}
                        type="button"
                        title={formatHypeTooltip(moment)}
                        onClick={() => handleHypeClick(moment)}
                        className={cn(
                          "absolute top-1 bottom-1 rounded-sm border text-left overflow-hidden",
                          "px-1 py-0.5 text-[9px] leading-tight truncate cursor-pointer",
                          hypeBarClass(moment.intensity, isActive)
                        )}
                        style={{
                          left: `${pct(moment.startTimeSeconds, maxTime)}%`,
                          width: `${Math.max(
                            pct(
                              moment.endTimeSeconds - moment.startTimeSeconds,
                              maxTime
                            ),
                            0.5
                          )}%`,
                        }}
                      >
                        {moment.intensity === "high"
                          ? "🔥"
                          : moment.clipItCount > 0
                            ? "clip"
                            : "hype"}
                      </button>
                    );
                  })
                )}
              </div>
            )}

            {/* CC Caption track — editable */}
            {showCaptionTrack && (
              <CaptionTimelineTrack
                cues={captionCues}
                maxTime={maxTime}
                currentTime={currentTime}
                height={CAPTION_TRACK_H}
                selectedCueId={selectedCaptionCueId}
                onSelectCue={setSelectedCaptionCueId}
                onSeek={onSeek}
                onBeginCueDrag={beginCueDrag}
                trackRef={captionTrackRef}
              />
            )}

            {!renderModalOpen && (
              <Playhead
                percent={playheadPct}
                tall
                onScrub={(e) => beginDrag("scrub", e)}
              />
            )}
            </div>
          </div>
        </div>
      </div>
    </div>

    <RenderClipModal
      open={renderModalOpen}
      onClose={() => setRenderModalOpen(false)}
      sessionId={sessionId}
      selection={selection}
      includeCaptions={includeCaptions}
      captionAppearance={captionAppearance}
      onClipCreated={onClipCreated}
    />
    </>
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
    <div
      data-timeline-playhead
      className="absolute top-0 bottom-0 z-[30] pointer-events-none"
      style={{ left: `${percent}%` }}
    >
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
