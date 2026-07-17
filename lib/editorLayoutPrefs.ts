"use client";

import {
  useCallback,
  useEffect,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

/** Bump key when default sizing changes so old prefs don't stick. */
const MONITOR_HEIGHT_KEY = "clipper.editor.monitorHeightPx.v2";
const CHAT_WIDTH_KEY = "clipper.editor.chatWidthPx.v1";
const CHAT_VISIBLE_KEY = "clipper.editor.chatVisible.v1";

const PROGRAM_CHROME_PX = 32;
const ASPECT = 16 / 9;
const DEFAULT_CHAT_WIDTH = 300;

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

function readStoredBoolean(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === "1" || raw === "true") return true;
    if (raw === "0" || raw === "false") return false;
    return fallback;
  } catch {
    return fallback;
  }
}

function writeStoredBoolean(key: string, value: boolean) {
  try {
    window.localStorage.setItem(key, value ? "1" : "0");
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
  const [chatWidth, setChatWidthState] = useState(() =>
    readStoredNumber(CHAT_WIDTH_KEY, DEFAULT_CHAT_WIDTH)
  );
  const [chatVisible, setChatVisibleState] = useState(() =>
    readStoredBoolean(CHAT_VISIBLE_KEY, true)
  );

  useEffect(() => {
    writeStoredNumber(MONITOR_HEIGHT_KEY, monitorHeight);
  }, [monitorHeight]);

  useEffect(() => {
    writeStoredNumber(CHAT_WIDTH_KEY, chatWidth);
  }, [chatWidth]);

  useEffect(() => {
    writeStoredBoolean(CHAT_VISIBLE_KEY, chatVisible);
  }, [chatVisible]);

  const setMonitorHeight = useCallback((next: number) => {
    const max = Math.max(260, window.innerHeight - 200);
    setMonitorHeightState(Math.round(Math.min(max, Math.max(200, next))));
  }, []);

  const setChatWidth = useCallback((next: number) => {
    const max = Math.max(220, Math.round(window.innerWidth * 0.42));
    setChatWidthState(Math.round(Math.min(max, Math.max(220, next))));
  }, []);

  const setChatVisible = useCallback((next: boolean) => {
    setChatVisibleState(next);
  }, []);

  const toggleChatVisible = useCallback(() => {
    setChatVisibleState((prev) => !prev);
  }, []);

  return {
    monitorHeight,
    setMonitorHeight,
    chatWidth,
    setChatWidth,
    chatVisible,
    setChatVisible,
    toggleChatVisible,
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
