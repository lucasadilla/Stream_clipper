"use client";

import {
  useCallback,
  useEffect,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

/** Bump key when default sizing changes so old prefs don't stick. */
const MONITOR_HEIGHT_KEY = "clipper.editor.monitorHeightPx.v2";

const PROGRAM_CHROME_PX = 32;
const ASPECT = 16 / 9;

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

/** Default monitor height so a centered 16:9 frame fits without eating the timeline. */
export function defaultMonitorHeight(): number {
  if (typeof window === "undefined") return 380;
  const availableWidth = Math.max(320, window.innerWidth - 24);
  const videoHeight = Math.round(Math.min(availableWidth, 960) / ASPECT);
  const pane = videoHeight + PROGRAM_CHROME_PX;
  const max = Math.round(window.innerHeight * 0.52);
  const min = 220;
  return Math.min(max, Math.max(min, pane));
}

export function useEditorLayoutPrefs() {
  const [monitorHeight, setMonitorHeightState] = useState(() =>
    readStoredNumber(MONITOR_HEIGHT_KEY, defaultMonitorHeight())
  );

  useEffect(() => {
    writeStoredNumber(MONITOR_HEIGHT_KEY, monitorHeight);
  }, [monitorHeight]);

  const setMonitorHeight = useCallback((next: number) => {
    const max = Math.max(260, window.innerHeight - 200);
    setMonitorHeightState(Math.round(Math.min(max, Math.max(200, next))));
  }, []);

  return {
    monitorHeight,
    setMonitorHeight,
  };
}

type Axis = "row" | "col";

export function beginPaneResize(options: {
  axis: Axis;
  startSize: number;
  onResize: (size: number) => void;
  event: ReactPointerEvent;
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
