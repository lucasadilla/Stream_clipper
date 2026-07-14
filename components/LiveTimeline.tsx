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
import { TimelineSequenceTools } from "@/components/TimelineSequenceTools";
import { MIN_CLIP_SECONDS, MAX_CLIP_SECONDS } from "@/lib/clipConstants";
import { cn } from "@/lib/cn";
import type { LiveTimelineSegment } from "@/lib/timelineSegments";
import type { TimelineThumbnail } from "@/services/timelineThumbnailService";
import {
  formatAudioSpikeTooltip,
  waveformHasSignal,
  type AudioSpikeMarker,
  type AudioSpikeIntensity,
  type WaveformBucket,
} from "@/lib/audioSpikeTimeline";
import {
  emptyEditorState,
  normalizeEditorState,
  segmentDuration,
  sequenceDuration,
  type EditorState,
  type TimelineMarker,
} from "@/lib/editorState";

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
  audioWaveform?: WaveformBucket[];
  audioSpikes?: AudioSpikeMarker[];
  aiMarkers?: TimelineMarker[];
  showAudioLane?: boolean;
}

type CaptionPatch = Partial<{
  text: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
}>;

type HistoryEntry =
  | { type: "state"; before: EditorState; after: EditorState }
  | {
      type: "caption";
      cueId: string;
      before: CaptionPatch;
      after: CaptionPatch;
      at: number;
    };

const VIDEO_TRACK_H = "min(22vh,100px)";
const AUDIO_TRACK_H = "min(14vh,72px)";
const CAPTION_TRACK_H = "min(10vh,56px)";
const OVERLAY_TRACK_H = "36px";

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

function audioSpikeBarClass(
  intensity: AudioSpikeIntensity,
  isActive: boolean
): string {
  if (isActive) {
    if (intensity === "high") {
      return "border-[var(--color-accent)] bg-[var(--color-accent)]/38 text-[#f4fff1] z-[6] shadow-[0_0_14px_rgba(149,255,0,0.32)]";
    }
    if (intensity === "medium") {
      return "border-[#b7ff3c]/70 bg-[#95ff00]/24 text-[#f4fff1] z-[5]";
    }
    return "border-[#5c8f1d]/60 bg-[#95ff00]/14 text-[#d8efc8] z-[4]";
  }
  if (intensity === "high") {
    return "border-[var(--color-accent)]/70 bg-[var(--color-accent)]/20 hover:bg-[var(--color-accent)]/30";
  }
  if (intensity === "medium") {
    return "border-[#b7ff3c]/45 bg-[#95ff00]/14 hover:bg-[#95ff00]/22";
  }
  return "border-[#5c8f1d]/35 bg-[#20350c]/40 hover:bg-[#20350c]/70";
}

function sampleTimelineItems<T>(
  items: T[],
  maxItems: number,
  keep?: (item: T) => boolean
): T[] {
  if (items.length <= maxItems) return items;

  const sampled: T[] = [];
  const step = Math.ceil(items.length / maxItems);

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    if (keep?.(item) || i % step === 0) sampled.push(item);
  }

  return sampled;
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
  audioWaveform = [],
  audioSpikes = [],
  aiMarkers = [],
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
  const [editorState, setEditorState] = useState<EditorState>(emptyEditorState);
  const [editorLoaded, setEditorLoaded] = useState(false);
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const undoStack = useRef<HistoryEntry[]>([]);
  const redoStack = useRef<HistoryEntry[]>([]);
  const [historyVersion, setHistoryVersion] = useState(0);

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
  const [scrollLeft, setScrollLeft] = useState(0);
  const scrollRaf = useRef<number | null>(null);
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

  const commitEditorState = useCallback((nextValue: EditorState) => {
    const next = normalizeEditorState(nextValue);
    setEditorState((current) => {
      if (JSON.stringify(current) === JSON.stringify(next)) return current;
      undoStack.current.push({ type: "state", before: current, after: next });
      if (undoStack.current.length > 100) undoStack.current.shift();
      redoStack.current = [];
      setHistoryVersion((version) => version + 1);
      return next;
    });
  }, []);

  const commitCaptionEdit = useCallback(
    (cueId: string, patch: CaptionPatch) => {
      if (!onCaptionEdit) return;
      const cue = applyCaptionEdits(
        buildCaptionTrack(captionChunks, "native"),
        captionEdits
      ).find((item) => item.id === cueId);
      if (!cue) {
        onCaptionEdit(cueId, patch);
        return;
      }
      const before: CaptionPatch = {
        text: cue.text,
        startTimeSeconds: cue.startTimeSeconds,
        endTimeSeconds: cue.endTimeSeconds,
      };
      const after: CaptionPatch = { ...before, ...patch };
      const previous = undoStack.current[undoStack.current.length - 1];
      if (
        previous?.type === "caption" &&
        previous.cueId === cueId &&
        Date.now() - previous.at < 700
      ) {
        previous.after = after;
        previous.at = Date.now();
      } else {
        undoStack.current.push({
          type: "caption",
          cueId,
          before,
          after,
          at: Date.now(),
        });
        if (undoStack.current.length > 100) undoStack.current.shift();
      }
      redoStack.current = [];
      setHistoryVersion((version) => version + 1);
      onCaptionEdit(cueId, patch);
    },
    [captionChunks, captionEdits, onCaptionEdit]
  );

  const undo = useCallback(() => {
    const entry = undoStack.current.pop();
    if (!entry) return;
    redoStack.current.push(entry);
    if (entry.type === "state") setEditorState(entry.before);
    else onCaptionEdit?.(entry.cueId, entry.before);
    setHistoryVersion((version) => version + 1);
  }, [onCaptionEdit]);

  const redo = useCallback(() => {
    const entry = redoStack.current.pop();
    if (!entry) return;
    undoStack.current.push(entry);
    if (entry.type === "state") setEditorState(entry.after);
    else onCaptionEdit?.(entry.cueId, entry.after);
    setHistoryVersion((version) => version + 1);
  }, [onCaptionEdit]);

  useEffect(() => {
    let cancelled = false;
    const storageKey = `clipper-editor-state:${sessionId}`;
    async function loadEditorState() {
      try {
        const response = await fetch(`/api/sessions/${sessionId}/editor-state`);
        const data = (await response.json()) as { state?: unknown };
        if (!cancelled && response.ok) {
          const loaded = normalizeEditorState(data.state);
          setEditorState(loaded);
          setSelectedSegmentId(loaded.segments[0]?.id ?? null);
          localStorage.setItem(storageKey, JSON.stringify(loaded));
          setEditorLoaded(true);
          return;
        }
      } catch {
        // Fall through to the browser copy.
      }
      if (cancelled) return;
      try {
        const cached = localStorage.getItem(storageKey);
        const loaded = normalizeEditorState(cached ? JSON.parse(cached) : null);
        setEditorState(loaded);
        setSelectedSegmentId(loaded.segments[0]?.id ?? null);
      } catch {
        setEditorState(emptyEditorState());
      }
      setEditorLoaded(true);
    }
    void loadEditorState();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    if (!editorLoaded) return;
    const storageKey = `clipper-editor-state:${sessionId}`;
    localStorage.setItem(storageKey, JSON.stringify(editorState));
    const timer = window.setTimeout(() => {
      void fetch(`/api/sessions/${sessionId}/editor-state`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: editorState }),
      });
    }, 650);
    return () => window.clearTimeout(timer);
  }, [editorLoaded, editorState, sessionId]);

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
  const showAudioTrack =
    showAudioLane ||
    waveformHasSignal(audioWaveform) ||
    audioSpikes.length > 0;

  const timelineMarkers = useMemo(() => {
    const audioMarkers: TimelineMarker[] = audioSpikes.map((marker) => ({
      id: `audio-${marker.id}`,
      timeSeconds: marker.startTimeSeconds,
      endTimeSeconds: marker.endTimeSeconds,
      label:
        marker.summary ||
        (marker.type === "volume_spike" ? "Volume spike" : "Loud section"),
      kind: "audio",
      score: marker.score,
      source: "ai",
    }));
    const byId = new Map<string, TimelineMarker>();
    for (const marker of [...editorState.markers, ...aiMarkers, ...audioMarkers]) {
      byId.set(marker.id, marker);
    }
    return [...byId.values()].sort((a, b) => a.timeSeconds - b.timeSeconds);
  }, [aiMarkers, audioSpikes, editorState.markers]);

  const snapPoints = useMemo(
    () => [
      ...captionCues.flatMap((cue) => [cue.startTimeSeconds, cue.endTimeSeconds]),
      ...timelineMarkers.flatMap((marker) => [
        marker.timeSeconds,
        ...(marker.endTimeSeconds != null ? [marker.endTimeSeconds] : []),
      ]),
    ],
    [captionCues, timelineMarkers]
  );

  const snapTimelineTime = useCallback(
    (seconds: number, fallbackStep = 1 / 30) => {
      const frameTime = snapTime(seconds, fallbackStep);
      if (!editorState.settings.snapping || snapPoints.length === 0) {
        return Math.max(0, Math.min(maxTime, frameTime));
      }
      const threshold = Math.min(
        0.4,
        Math.max(0.04, maxTime / Math.max(1, viewportWidth * zoom) * 9)
      );
      let closest = frameTime;
      let distance = threshold;
      for (const point of snapPoints) {
        const nextDistance = Math.abs(point - seconds);
        if (nextDistance <= distance) {
          closest = point;
          distance = nextDistance;
        }
      }
      return Math.max(0, Math.min(maxTime, closest));
    },
    [editorState.settings.snapping, maxTime, snapPoints, viewportWidth, zoom]
  );

  const addManualMarker = useCallback(() => {
    const marker: TimelineMarker = {
      id: crypto.randomUUID(),
      timeSeconds: currentTime,
      label: `Marker ${editorState.markers.length + 1}`,
      kind: "manual",
      source: "manual",
    };
    commitEditorState({
      ...editorState,
      markers: [...editorState.markers, marker],
    });
  }, [commitEditorState, currentTime, editorState]);

  useEffect(() => {
    if (
      selectedSegmentId &&
      !editorState.segments.some((segment) => segment.id === selectedSegmentId)
    ) {
      setSelectedSegmentId(editorState.segments[0]?.id ?? null);
    }
  }, [editorState.segments, selectedSegmentId]);

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

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    function onScroll() {
      if (scrollRaf.current !== null) return;
      scrollRaf.current = requestAnimationFrame(() => {
        scrollRaf.current = null;
        setScrollLeft(scrollRef.current?.scrollLeft ?? 0);
      });
    }

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (scrollRaf.current !== null) cancelAnimationFrame(scrollRaf.current);
    };
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

      // Trackpad horizontal swipe - scroll the timeline.
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        scroll.scrollLeft += e.deltaX;
        return;
      }

      // Shift+wheel - horizontal scroll (when zoomed in).
      if (e.shiftKey) {
        e.preventDefault();
        scroll.scrollLeft += e.deltaY;
        return;
      }

      // Wheel - zoom in/out around cursor position.
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
      const t = snapTimelineTime(
        isCueDrag ? timeFromCaptionTrack(e.clientX) : timeFromVideoTrack(e.clientX),
        1 / 30
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
        const scrubT = snapTimelineTime(
          videoTrackRef.current
            ? timeFromVideoTrack(e.clientX)
            : timeFromRef(e.clientX, rulerRef),
          1 / 30
        );
        onScrub(scrubT);
      } else if (dragging === "cue-start" && origin.cueId && onCaptionEdit) {
        const range = clampCueRange(t, origin.cueEnd, maxTime);
        commitCaptionEdit(origin.cueId, range);
      } else if (dragging === "cue-end" && origin.cueId && onCaptionEdit) {
        const range = clampCueRange(origin.cueStart, t, maxTime);
        commitCaptionEdit(origin.cueId, range);
      } else if (dragging === "cue-move" && origin.cueId && onCaptionEdit) {
        const el = captionTrackRef.current ?? videoTrackRef.current;
        if (!el) return;
        const width = origin.cueEnd - origin.cueStart;
        const dt = (e.clientX - origin.x) / el.getBoundingClientRect().width;
        const delta = dt * maxTime;
        let start = origin.cueStart + delta;
        start = Math.max(0, Math.min(start, maxTime - width));
        commitCaptionEdit(origin.cueId, {
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
    commitCaptionEdit,
    snapTimelineTime,
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
      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && key === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (key === "i") setInPoint();
      if (key === "o") setOutPoint();
      if (key === "m") addManualMarker();
      if (key === "j") onSeek(Math.max(0, currentTime - 2));
      if (key === "k") onPause();
      if (key === "l") onSeek(currentTime);

      const selectedSegment = editorState.segments.find(
        (segment) => segment.id === selectedSegmentId
      );
      if (key === "b" && selectedSegment) {
        if (
          currentTime > selectedSegment.sourceStart + 0.15 &&
          currentTime < selectedSegment.sourceEnd - 0.15
        ) {
          const index = editorState.segments.findIndex(
            (segment) => segment.id === selectedSegment.id
          );
          const left = {
            ...selectedSegment,
            id: crypto.randomUUID(),
            sourceEnd: currentTime,
            label: `${selectedSegment.label} A`,
          };
          const right = {
            ...selectedSegment,
            id: crypto.randomUUID(),
            sourceStart: currentTime,
            label: `${selectedSegment.label} B`,
          };
          const next = [...editorState.segments];
          next.splice(index, 1, left, right);
          commitEditorState({ ...editorState, segments: next });
          setSelectedSegmentId(right.id);
          onSelectionChange({ start: right.sourceStart, end: right.sourceEnd });
        }
      }

      if ((e.key === "Delete" || e.key === "Backspace") && selectedSegment) {
        e.preventDefault();
        const next = editorState.segments.filter(
          (segment) => segment.id !== selectedSegment.id
        );
        commitEditorState({
          ...editorState,
          segments: next,
          overlays: editorState.overlays.filter(
            (overlay) => overlay.segmentId !== selectedSegment.id
          ),
        });
        setSelectedSegmentId(next[0]?.id ?? null);
      }

      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const delta = (e.key === "ArrowLeft" ? -1 : 1) / 30;
        if (e.altKey && selectedSegment) {
          const nextSelection = e.shiftKey
            ? clampSelection(
                selectedSegment.sourceStart,
                selectedSegment.sourceEnd + delta,
                maxTime
              )
            : clampSelection(
                selectedSegment.sourceStart + delta,
                selectedSegment.sourceEnd,
                maxTime,
                { fixedEnd: true }
              );
          onSelectionChange(nextSelection);
          commitEditorState({
            ...editorState,
            segments: editorState.segments.map((segment) =>
              segment.id === selectedSegment.id
                ? {
                    ...segment,
                    sourceStart: nextSelection.start,
                    sourceEnd: nextSelection.end,
                  }
                : segment
            ),
          });
        } else {
          onPause();
          onScrub(Math.max(0, Math.min(maxTime, currentTime + delta)));
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const playheadPct = pct(currentTime, maxTime);
  const recordedPct = pct(recordedSeconds, maxTime);
  const selStartPct = pct(selection.start, maxTime);
  const selWidthPct = pct(selection.end - selection.start, maxTime);

  const visibleTimeRange = useMemo(() => {
    if (maxTime <= 0 || trackContentWidth <= 0 || viewportWidth <= 0) {
      return { start: 0, end: maxTime };
    }

    const viewStartPx = Math.max(0, scrollLeft - TRACK_LABEL_W);
    const viewEndPx = viewStartPx + viewportWidth;
    const bufferPx = viewportWidth * 0.75;
    const start = ((viewStartPx - bufferPx) / trackContentWidth) * maxTime;
    const end = ((viewEndPx + bufferPx) / trackContentWidth) * maxTime;
    return {
      start: Math.max(0, start),
      end: Math.min(maxTime, end),
    };
  }, [maxTime, scrollLeft, trackContentWidth, viewportWidth]);

  const visibleThumbnails = useMemo(
    () =>
      sampleTimelineItems(
        thumbnails.filter(
          (thumb) =>
            thumb.endTimeSeconds >= visibleTimeRange.start &&
            thumb.startTimeSeconds <= visibleTimeRange.end
        ),
        360
      ),
    [thumbnails, visibleTimeRange.start, visibleTimeRange.end]
  );

  const visibleSegments = useMemo(
    () =>
      sampleTimelineItems(
        segments.filter(
          (seg) =>
            seg.endTimeSeconds >= visibleTimeRange.start &&
            seg.startTimeSeconds <= visibleTimeRange.end
        ),
        500
      ),
    [segments, visibleTimeRange.start, visibleTimeRange.end]
  );

  const visibleWaveform = useMemo(
    () =>
      sampleTimelineItems(
        audioWaveform.filter(
          (bucket) =>
            bucket.endTimeSeconds >= visibleTimeRange.start &&
            bucket.startTimeSeconds <= visibleTimeRange.end
        ),
        900
      ),
    [audioWaveform, visibleTimeRange.start, visibleTimeRange.end]
  );

  const visibleAudioSpikes = useMemo(
    () =>
      audioSpikes.filter(
        (marker) =>
          marker.endTimeSeconds >= visibleTimeRange.start &&
          marker.startTimeSeconds <= visibleTimeRange.end
      ),
    [audioSpikes, visibleTimeRange.start, visibleTimeRange.end]
  );

  const visibleCaptionCues = useMemo(
    () =>
      sampleTimelineItems(
        captionCues.filter(
          (cue) =>
            cue.endTimeSeconds >= visibleTimeRange.start &&
            cue.startTimeSeconds <= visibleTimeRange.end
        ),
        800,
        (cue) => cue.id === selectedCaptionCueId
      ),
    [
      captionCues,
      visibleTimeRange.start,
      visibleTimeRange.end,
      selectedCaptionCueId,
    ]
  );

  let tickStep = getTickStep(maxTime, zoom);
  while (
    maxTime > 0 &&
    trackContentWidth > 0 &&
    (tickStep / maxTime) * trackContentWidth < 52
  ) {
    tickStep *= 2;
  }
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
  const renderDuration =
    editorState.segments.length > 0
      ? sequenceDuration(editorState.segments)
      : selection.end - selection.start;
  const canUndo = historyVersion >= 0 && undoStack.current.length > 0;
  const canRedo = historyVersion >= 0 && redoStack.current.length > 0;
  const showOverlayTrack = editorState.overlays.length > 0;
  const overlayBars = editorState.overlays.flatMap((overlay) => {
    const segment = editorState.segments.find((item) => item.id === overlay.segmentId);
    if (!segment) return [];
    const start = segment.sourceStart + overlay.startOffsetSeconds;
    const end = Math.min(
      segment.sourceEnd,
      segment.sourceStart + overlay.endOffsetSeconds
    );
    return end > start ? [{ overlay, segment, start, end }] : [];
  });

  return (
    <>
    <div
      className={cn(
        "h-full flex flex-col rounded-lg border border-[var(--color-card-border)] bg-[#050705] overflow-hidden shadow-[0_18px_70px_rgba(0,0,0,0.35)] transition-opacity",
        renderModalOpen && "opacity-40 pointer-events-none select-none"
      )}
      aria-hidden={renderModalOpen}
    >
      {/* Editor toolbar */}
      <div className="shrink-0 flex flex-wrap items-center gap-2 px-3 py-2 border-b border-[var(--color-card-border)] bg-[#020302]">
        <div className="flex items-center gap-1">
          <ToolBtn onClick={setInPoint} title="Mark In (I)">
            In
          </ToolBtn>
          <ToolBtn onClick={setOutPoint} title="Mark Out (O)">
            Out
          </ToolBtn>
          <ToolBtn onClick={() => onSeek(selection.start)} title="Play from In point">
            Play
          </ToolBtn>
          <ToolBtn onClick={onPause} title="Pause">
            Pause
          </ToolBtn>
        </div>

        <div className="font-mono text-xs text-[#dfead8] tabular-nums">
          <span className="text-[var(--color-accent)]">{formatSeconds(selection.start)}</span>
          <span className="text-[#666] mx-1.5">to</span>
          <span className="text-[var(--color-accent)]">{formatSeconds(selection.end)}</span>
          <span className="text-[#71806d] ml-2">({formatDuration(selection.end - selection.start)})</span>
        </div>

        {audioSpikes.length > 0 && (
          <span
            className="text-[10px] font-medium uppercase text-[var(--color-accent)] tabular-nums"
            title="Audio spikes on timeline"
          >
            Audio {audioSpikes.length}
          </span>
        )}

        <div className="flex items-center gap-1 border-l border-[var(--color-card-border)] pl-2 ml-1">
          <ToolBtn onClick={zoomOut} title="Zoom out" disabled={atMinZoom}>
            -
          </ToolBtn>
          <button
            type="button"
            onClick={zoomToFit}
            title="Zoom to fit"
            className="min-w-[44px] h-7 px-1.5 text-[10px] font-mono text-[#9aa49a] border border-[#21301f] bg-[#070a07] hover:border-[var(--color-accent)] hover:text-white transition-colors"
          >
            {zoomLabel}
          </button>
          <ToolBtn onClick={zoomIn} title="Zoom in (scroll wheel)" disabled={zoom >= MAX_ZOOM}>
            +
          </ToolBtn>
        </div>

        <div className="font-mono text-xs text-[#9aa49a] ml-auto">
          {formatSeconds(currentTime)}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setRenderModalOpen(true)}
            disabled={
              renderDuration < MIN_CLIP_SECONDS ||
              renderDuration > MAX_CLIP_SECONDS
            }
            title={
              renderDuration > MAX_CLIP_SECONDS
                ? `Clip must be ${MAX_CLIP_SECONDS / 60} minutes or shorter`
                : "Render clip - pick aspect ratio, title, and export options"
            }
            className={cn(
              "text-xs px-4 py-1.5 rounded-lg font-semibold",
              "bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-black",
              "disabled:opacity-40"
            )}
          >
            Render
          </button>
        </div>
      </div>

      <TimelineSequenceTools
        sessionId={sessionId}
        state={editorState}
        maxTime={maxTime}
        selection={selection}
        currentTime={currentTime}
        selectedSegmentId={selectedSegmentId}
        markers={timelineMarkers}
        captionChunks={captionChunks}
        canUndo={canUndo}
        canRedo={canRedo}
        onCommit={commitEditorState}
        onSelectionChange={onSelectionChange}
        onSelectSegment={setSelectedSegmentId}
        onUndo={undo}
        onRedo={redo}
      />

      {selectedCaptionCue && onCaptionEdit && (
        <CaptionCueEditor
          cue={selectedCaptionCue}
          onSave={(text) => commitCaptionEdit(selectedCaptionCue.id, { text })}
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
          {/* Track labels gutter - stays visible while scrolling */}
          <div
            className="sticky left-0 z-20 shrink-0 border-r border-[var(--color-card-border)] bg-[#020302] flex flex-col"
            style={{ width: TRACK_LABEL_W }}
          >
            <div className="h-7 border-b border-[var(--color-card-border)]" />
            <div
              className="flex items-center justify-center border-b border-[var(--color-card-border)]"
              style={{ height: VIDEO_TRACK_H }}
            >
              <span className="text-[10px] font-semibold text-[#9aa49a]">V1</span>
            </div>
            {showAudioTrack && (
              <div
                className="flex items-center justify-center border-b border-[var(--color-card-border)]"
                style={{ height: AUDIO_TRACK_H }}
              >
                <span className="text-[10px] font-semibold text-[var(--color-accent)]">A1</span>
              </div>
            )}
            {showOverlayTrack && (
              <div
                className="flex items-center justify-center border-b border-[var(--color-card-border)]"
                style={{ height: OVERLAY_TRACK_H }}
              >
                <span className="text-[10px] font-semibold text-[#f1efe7]">O1</span>
              </div>
            )}
            {showCaptionTrack && (
              <div
                className="flex items-center justify-center border-b border-[var(--color-card-border)]"
                style={{ height: CAPTION_TRACK_H }}
              >
                <span className="text-[10px] font-semibold text-[#d7ff64]">CC</span>
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
              className="relative h-7 bg-[#030403] border-b border-[var(--color-card-border)] cursor-ew-resize shrink-0"
              onPointerDown={(e) => {
                const t = snapTimelineTime(timeFromRef(e.clientX, rulerRef), 1 / 30);
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
                  <div className="w-px h-2 bg-[#3f5634] mt-auto" />
                  <span className="absolute top-0.5 left-1 text-[9px] text-[#71806d] font-mono whitespace-nowrap">
                    {formatSeconds(t)}
                  </span>
                </div>
              ))}
              {timelineMarkers
                .filter(
                  (marker) =>
                    marker.timeSeconds >= visibleTimeRange.start &&
                    marker.timeSeconds <= visibleTimeRange.end
                )
                .map((marker) => (
                  <button
                    key={marker.id}
                    type="button"
                    title={`${marker.label}${marker.score != null ? ` / score ${marker.score.toFixed(1)}` : ""}`}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => {
                      onPause();
                      onScrub(marker.timeSeconds);
                      if (marker.endTimeSeconds != null) {
                        onSelectionChange(
                          clampSelection(
                            marker.timeSeconds,
                            marker.endTimeSeconds,
                            maxTime
                          )
                        );
                      }
                    }}
                    className={cn(
                      "absolute top-0 z-10 h-3 w-2 -translate-x-1 border-x-[4px] border-x-transparent border-t-[7px]",
                      marker.kind === "manual"
                        ? "border-t-white"
                        : marker.kind === "audio"
                          ? "border-t-[var(--color-accent)]"
                          : marker.kind === "laughter"
                            ? "border-t-[#ffb84d]"
                            : marker.kind === "chat"
                              ? "border-t-[#62d4a4]"
                              : "border-t-[#d7ff64]"
                    )}
                    style={{ left: `${pct(marker.timeSeconds, maxTime)}%` }}
                  />
                ))}
              {!renderModalOpen && (
                <Playhead
                  percent={playheadPct}
                  tall
                  onScrub={(e) => beginDrag("scrub", e)}
                />
              )}
            </div>

            {/* Tracks stack - shared playhead spans video + captions */}
            <div className="relative shrink-0">
              {/* V1 Video track */}
              <div
                ref={videoTrackRef}
                className="relative bg-[#020302] border-b border-[var(--color-card-border)] cursor-crosshair"
                style={{ height: VIDEO_TRACK_H }}
                onPointerDown={handleVideoTrackPointerDown}
              >
              {/* Filmstrip */}
              <div className="absolute inset-0 pointer-events-none">
                {thumbnails.length > 0
                  ? visibleThumbnails.map((thumb, index) => (
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
                          fetchPriority={index < 8 ? "high" : "auto"}
                        />
                      </div>
                    ))
                  : visibleSegments.map((seg) => (
                      <div
                        key={seg.id}
                        title={seg.label}
                        className={cn(
                          "absolute top-0 bottom-0 border-r border-[#21301f] bg-[#081008]",
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
                {thumbnails.length > 0 &&
                  visibleSegments
                    .filter((seg) => !seg.id.startsWith("synthetic-"))
                    .map((seg) => (
                      <div
                        key={`tx-${seg.id}`}
                        title={seg.label}
                        className={cn(
                          "absolute top-0 bottom-0 border-r border-white/15",
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
                className="absolute inset-y-0 right-0 bg-[#020302]/82 pointer-events-none"
                style={{ left: `${recordedPct}%` }}
              />
              {isLive && recordedSeconds > 0 && (
                <div
                  className="absolute top-0 bottom-0 w-px bg-red-500/80 z-[2]"
                  style={{ left: `${recordedPct}%` }}
                />
              )}

              {editorState.segments.map((segment, index) => (
                <button
                  key={`sequence-source-${segment.id}`}
                  type="button"
                  title={`${index + 1}. ${segment.label} / ${formatDuration(segmentDuration(segment))}`}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => {
                    setSelectedSegmentId(segment.id);
                    onSelectionChange({
                      start: segment.sourceStart,
                      end: segment.sourceEnd,
                    });
                    onPause();
                    onScrub(segment.sourceStart);
                  }}
                  className={cn(
                    "absolute bottom-1 top-1 z-[3] border bg-black/36 text-left",
                    selectedSegmentId === segment.id
                      ? "border-white/85"
                      : "border-[var(--color-accent)]/55"
                  )}
                  style={{
                    left: `${pct(segment.sourceStart, maxTime)}%`,
                    width: `${Math.max(
                      pct(segmentDuration(segment), maxTime),
                      0.3
                    )}%`,
                  }}
                >
                  <span className="absolute left-1 top-1 bg-[#020302]/85 px-1 font-mono text-[9px] text-[var(--color-accent)]">
                    {index + 1}
                  </span>
                </button>
              ))}

              {/* Active clip selection. */}
              <div
                className="absolute top-0 bottom-0 z-[5] border-2 border-[var(--color-accent)]"
                style={{
                  left: `${selStartPct}%`,
                  width: `${Math.max(selWidthPct, 0.2)}%`,
                }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <div
                  className="absolute left-0 top-0 bottom-0 w-2 -ml-1 bg-[var(--color-accent)] cursor-ew-resize z-10"
                  onPointerDown={(e) => beginDrag("start", e)}
                />
                <div
                  className="absolute inset-x-2 inset-y-0 cursor-grab active:cursor-grabbing"
                  onPointerDown={(e) => beginDrag("move", e)}
                />
                <div
                  className="absolute right-0 top-0 bottom-0 w-2 -mr-1 bg-[var(--color-accent)] cursor-ew-resize z-10"
                  onPointerDown={(e) => beginDrag("end", e)}
                />
              </div>

            </div>

            {/* Audio loudness + spike lane */}
            {showAudioTrack && (
              <div
                className="relative bg-[#031006] border-b border-[var(--color-card-border)] shrink-0 overflow-hidden"
                style={{ height: AUDIO_TRACK_H }}
              >
                {visibleWaveform.map((bucket, i) => (
                  <div
                    key={`wf-${i}`}
                    className="absolute bottom-0 bg-[var(--color-accent)]/28 pointer-events-none rounded-t-[1px]"
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

                {audioWaveform.length === 0 && audioSpikes.length === 0 && (
                  <div className="absolute inset-0 flex items-center justify-center text-[9px] text-[var(--color-accent)]/35 pointer-events-none">
                    {isLive ? "Analyzing audio levels..." : "No audio spikes yet"}
                  </div>
                )}

                {visibleAudioSpikes.map((marker) => {
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

            {showOverlayTrack && (
              <div
                className="relative shrink-0 overflow-hidden border-b border-[var(--color-card-border)] bg-[#080908]"
                style={{ height: OVERLAY_TRACK_H }}
              >
                {overlayBars.map(({ overlay, segment, start, end }) => (
                  <button
                    key={overlay.id}
                    type="button"
                    title={`${overlay.type}: ${overlay.label}`}
                    onClick={() => {
                      setSelectedSegmentId(segment.id);
                      onSelectionChange({ start, end });
                    }}
                    className="absolute bottom-1 top-1 min-w-[3px] overflow-hidden border border-[#f1efe7]/55 bg-[#f1efe7]/10 px-1 text-left text-[9px] text-[#f1efe7]"
                    style={{
                      left: `${pct(start, maxTime)}%`,
                      width: `${Math.max(pct(end - start, maxTime), 0.3)}%`,
                    }}
                  >
                    <span className="truncate">{overlay.label}</span>
                  </button>
                ))}
              </div>
            )}

            {/* CC Caption track - editable */}
            {showCaptionTrack && (
              <CaptionTimelineTrack
                cues={visibleCaptionCues}
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
      captionCues={captionCues}
      editorState={editorState}
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
          "absolute top-0 bottom-0 w-px bg-[var(--color-accent)] -translate-x-1/2 shadow-[0_0_12px_rgba(149,255,0,0.55)]",
          onScrub && "pointer-events-auto cursor-ew-resize"
        )}
        onPointerDown={onScrub}
      />
      <div
        className={cn(
          "absolute -translate-x-1/2 w-0 h-0",
          tall ? "-top-0" : "top-0",
          "border-l-[6px] border-r-[6px] border-t-[8px]",
          "border-l-transparent border-r-transparent border-t-[var(--color-accent)]",
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
  const label =
    title === "Play from In point"
      ? "Play"
      : title === "Pause"
        ? "Pause"
        : title === "Zoom out"
          ? "-"
          : title === "Zoom in (scroll wheel)"
            ? "+"
            : children;

  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className="h-7 min-w-7 px-2 flex items-center justify-center text-[10px] font-semibold uppercase text-[#9aa49a] border border-[#21301f] bg-[#070a07] hover:border-[var(--color-accent)] hover:text-white disabled:opacity-30 disabled:pointer-events-none transition-colors"
    >
      {label}
    </button>
  );
}
