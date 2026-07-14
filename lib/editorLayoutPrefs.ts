"use client";

import {
  useCallback,
  useEffect,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

const MONITOR_HEIGHT_KEY = "clipper.editor.monitorHeightPx";
const TRANSCRIPT_WIDTH_KEY = "clipper.editor.transcriptWidthPx";

function readStoredNumber(key: string, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function writeStoredNumber(key: string, value: number) {
  try {
    window.localStorage.setItem(key, String(Math.round(value)));
  } catch {
    // ignore quota / private mode
  }
}

function defaultMonitorHeight(): number {
  if (typeof window === "undefined") return 420;
  return Math.round(
    Math.min(520, Math.max(280, window.innerHeight * 0.46))
  );
}

export function useEditorLayoutPrefs() {
  const [monitorHeight, setMonitorHeightState] = useState(() =>
    readStoredNumber(MONITOR_HEIGHT_KEY, defaultMonitorHeight())
  );
  const [transcriptWidth, setTranscriptWidthState] = useState(() =>
    readStoredNumber(TRANSCRIPT_WIDTH_KEY, 320)
  );

  useEffect(() => {
    writeStoredNumber(MONITOR_HEIGHT_KEY, monitorHeight);
  }, [monitorHeight]);

  useEffect(() => {
    writeStoredNumber(TRANSCRIPT_WIDTH_KEY, transcriptWidth);
  }, [transcriptWidth]);

  const setMonitorHeight = useCallback((next: number) => {
    const max = Math.max(240, window.innerHeight - 220);
    setMonitorHeightState(Math.round(Math.min(max, Math.max(180, next))));
  }, []);

  const setTranscriptWidth = useCallback((next: number) => {
    const max = Math.max(220, window.innerWidth - 360);
    setTranscriptWidthState(Math.round(Math.min(max, Math.max(200, next))));
  }, []);

  return {
    monitorHeight,
    setMonitorHeight,
    transcriptWidth,
    setTranscriptWidth,
  };
}

type Axis = "row" | "col";

export function beginPaneResize(options: {
  axis: Axis;
  startSize: number;
  onResize: (size: number) => void;
  event: ReactPointerEvent;
  /** row: growing downward; col: growing rightward */
  invert?: boolean;
}) {
  const { axis, startSize, onResize, event, invert = false } = options;
  event.preventDefault();
  event.stopPropagation();

  const startPos = axis === "row" ? event.clientY : event.clientX;
  const target = event.currentTarget as HTMLElement;
  target.setPointerCapture(event.pointerId);

  function onMove(e: PointerEvent) {
    const pos = axis === "row" ? e.clientY : e.clientX;
    const delta = invert ? startPos - pos : pos - startPos;
    onResize(startSize + delta);
  }

  function onUp(e: PointerEvent) {
    target.releasePointerCapture(e.pointerId);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  }

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}
