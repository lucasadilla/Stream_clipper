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
import {
  buildCaptionTrack,
  lookupCueAtTime,
  type CaptionCue,
} from "@/lib/captionTrack";
import { CaptionAppearancePanel } from "@/components/CaptionAppearancePanel";
import {
  applyCaptionCapitalization,
  captionPreviewStyle,
  type CaptionAppearance,
} from "@/lib/captionAppearance";
import type { ClipSuggestionData } from "@/components/ClipSuggestionCard";
import { fetchJson } from "@/lib/apiClient";
import { LookVideoStage } from "@/components/agent/AgentStudioPreviews";
import type { ContentLookPresetId } from "@/lib/contentLookPresets";
import { getContentLookPreset } from "@/lib/contentLookPresets";
import {
  detectBrowserFaces,
  loadBrowserFaceDetector,
  selectBrowserTrackedFace,
  smoothBrowserFaceRect,
  type BrowserFaceRect,
} from "@/lib/browserFaceTracking";

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
  /** Instant look applied to the single preview. */
  lookPreset?: ContentLookPresetId;
  /** Normalized face box for centering look crops. */
  faceRect?: { x: number; y: number; width: number; height: number } | null;
  faceKeyframes?: Array<{ timestampSeconds: number; centerX: number }>;
}

function trackedCenterAt(
  keyframes: Array<{ timestampSeconds: number; centerX: number }>,
  relativeTime: number
): number | null {
  if (keyframes.length === 0) return null;
  if (relativeTime <= keyframes[0]!.timestampSeconds) {
    return keyframes[0]!.centerX;
  }
  for (let index = 1; index < keyframes.length; index++) {
    const next = keyframes[index]!;
    if (relativeTime > next.timestampSeconds) continue;
    const previous = keyframes[index - 1]!;
    const span = Math.max(
      0.001,
      next.timestampSeconds - previous.timestampSeconds
    );
    const progress = Math.min(
      1,
      Math.max(0, (relativeTime - previous.timestampSeconds) / span)
    );
    return previous.centerX + (next.centerX - previous.centerX) * progress;
  }
  return keyframes[keyframes.length - 1]!.centerX;
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
  lookPreset = "auto",
  faceRect = null,
  faceKeyframes = [],
}: AgentClipEditorProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [currentTime, setCurrentTime] = useState(clip.startTimeSeconds);
  const [dragging, setDragging] = useState<"start" | "end" | "playhead" | null>(
    null
  );
  const [chunks, setChunks] = useState<TranscriptChunk[]>([]);
  const [chunksLoading, setChunksLoading] = useState(true);
  const [edits, setEdits] = useState<CaptionEditsMap>({});
  const [editingCueId, setEditingCueId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [previewHeight, setPreviewHeight] = useState(400);
  const [browserFaceRect, setBrowserFaceRect] =
    useState<BrowserFaceRect | null>(null);
  const [browserTrackingStatus, setBrowserTrackingStatus] = useState<
    "idle" | "loading" | "ready" | "unavailable"
  >("idle");
  const startRef = useRef(clip.startTimeSeconds);
  const endRef = useRef(clip.endTimeSeconds);
  startRef.current = clip.startTimeSeconds;
  endRef.current = clip.endTimeSeconds;

  const maxTime = Math.max(sourceDuration, clip.endTimeSeconds, 1);
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
    const el = previewRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setPreviewHeight(entry?.contentRect.height ?? 400);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setChunksLoading(true);
    void (async () => {
      // /transcribe does not return chunks — load from /events like the timeline.
      const [events, cap] = await Promise.all([
        fetchJson<{
          transcriptChunks?: TranscriptChunk[];
        }>(`/api/sessions/${sessionId}/events`),
        fetchJson<{ edits?: CaptionEditsMap }>(
          `/api/sessions/${sessionId}/captions`
        ),
      ]);
      if (cancelled) return;
      if (events.ok) {
        setChunks(events.data.transcriptChunks ?? []);
      }
      if (cap.ok && cap.data.edits) {
        setEdits(cap.data.edits);
      }
      setChunksLoading(false);
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

  const activeCue = useMemo(
    () => lookupCueAtTime(cues, currentTime),
    [cues, currentTime]
  );

  const previewStyles = useMemo(
    () => captionPreviewStyle(captionAppearance, previewHeight),
    [captionAppearance, previewHeight]
  );

  const displayText = activeCue
    ? applyCaptionCapitalization(
        activeCue.text,
        captionAppearance.capitalization
      )
    : null;
  const trackedFaceCenterX = useMemo(
    () =>
      trackedCenterAt(
        faceKeyframes,
        Math.max(0, currentTime - clip.startTimeSeconds)
      ),
    [faceKeyframes, currentTime, clip.startTimeSeconds]
  );
  const needsFaceTracking = getContentLookPreset(lookPreset).needsFaceAnalysis;
  const hasServerTracking = faceKeyframes.length > 0;

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !playbackUrl || !needsFaceTracking || hasServerTracking) {
      setBrowserTrackingStatus("idle");
      setBrowserFaceRect(null);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let loading = false;
    let detector: Awaited<ReturnType<typeof loadBrowserFaceDetector>> | null =
      null;
    let previousRect: BrowserFaceRect | null = faceRect;
    let lastVideoTime = -1;

    const schedule = (delay: number) => {
      if (cancelled) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void analyze(false), delay);
    };

    const analyze = async (force: boolean) => {
      if (cancelled || loading) return;
      if (video.readyState < 2 || video.videoWidth <= 0) {
        schedule(400);
        return;
      }
      if (!force && Math.abs(video.currentTime - lastVideoTime) < 0.02) {
        schedule(video.paused ? 700 : 320);
        return;
      }

      loading = true;
      try {
        if (!detector) {
          setBrowserTrackingStatus("loading");
          detector = await loadBrowserFaceDetector();
          if (cancelled) return;
        }
        const detections = detectBrowserFaces(detector, video);
        lastVideoTime = video.currentTime;
        const selected = selectBrowserTrackedFace(
          detections,
          video.videoWidth,
          video.videoHeight,
          previousRect
        );
        if (selected) {
          previousRect = smoothBrowserFaceRect(previousRect, selected);
          setBrowserFaceRect(previousRect);
          setBrowserTrackingStatus("ready");
        }
      } catch {
        setBrowserTrackingStatus("unavailable");
        cancelled = true;
      } finally {
        loading = false;
        if (!cancelled) schedule(video.paused ? 700 : 320);
      }
    };

    const analyzeNow = () => void analyze(true);
    video.addEventListener("loadeddata", analyzeNow);
    video.addEventListener("play", analyzeNow);
    video.addEventListener("seeked", analyzeNow);
    void analyze(true);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      video.removeEventListener("loadeddata", analyzeNow);
      video.removeEventListener("play", analyzeNow);
      video.removeEventListener("seeked", analyzeNow);
    };
  }, [
    playbackUrl,
    clip.id,
    needsFaceTracking,
    hasServerTracking,
    faceRect,
  ]);

  const effectiveFaceRect = faceRect ?? browserFaceRect;
  const effectiveFaceCenterX =
    trackedFaceCenterX ??
    (browserFaceRect
      ? browserFaceRect.x + browserFaceRect.width / 2
      : null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !playbackUrl) return;
    const seek = () => {
      try {
        video.currentTime = clip.startTimeSeconds;
        setCurrentTime(clip.startTimeSeconds);
      } catch {
        // ignore
      }
    };
    if (video.readyState >= 1) seek();
    else video.addEventListener("loadedmetadata", seek, { once: true });
  }, [playbackUrl, clip.id, clip.startTimeSeconds]);

  const commitRange = useCallback(
    async (start: number, end: number) => {
      const s = Math.max(0, Math.min(start, maxTime));
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

  const seekVideo = useCallback((t: number) => {
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
  }, []);

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
        seekVideo(t);
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
  }, [
    dragging,
    timeFromClientX,
    clip,
    onClipChange,
    commitRange,
    maxTime,
    seekVideo,
  ]);

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
  const playPct = toPct(Math.max(viewStart, Math.min(viewEnd, currentTime)));

  const useKaraoke =
    captionAppearance.karaokeEnabled &&
    activeCue?.words &&
    activeCue.words.length > 0;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{clip.title}</h2>
        <p className="text-xs text-[var(--color-muted)]">
          One preview — look + captions update live. Drag the handles to trim.
        </p>
        <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#8f9b89]">
          {getContentLookPreset(lookPreset).label} look
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-[var(--color-card-border)] bg-black">
        <div
          ref={previewRef}
          className="relative mx-auto max-h-[56vh] w-full max-w-sm"
        >
          <LookVideoStage
            presetId={lookPreset}
            playbackUrl={playbackUrl}
            videoRef={videoRef}
            faceRect={effectiveFaceRect}
            faceCenterX={effectiveFaceCenterX}
            className="mx-auto max-h-[56vh] w-full rounded-none border-0"
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
          >
            {needsFaceTracking && !hasServerTracking && (
              <div className="pointer-events-none absolute left-2 top-2 z-20 rounded bg-black/70 px-2 py-1 text-[10px] font-semibold text-white">
                <span
                  className={cn(
                    "mr-1.5 inline-block h-1.5 w-1.5 rounded-full",
                    browserTrackingStatus === "ready"
                      ? "bg-[var(--color-accent)]"
                      : browserTrackingStatus === "unavailable"
                        ? "bg-[var(--color-warning,#e6b84d)]"
                        : "animate-pulse bg-white/70"
                  )}
                />
                {browserTrackingStatus === "ready"
                  ? "Preview tracking"
                  : browserTrackingStatus === "unavailable"
                    ? "Server tracking"
                    : "Loading preview tracking"}
              </div>
            )}
            {includeCaptions ? (
              <div className="absolute inset-0 overflow-hidden">
                <div style={previewStyles.container}>
                  {activeCue && displayText ? (
                    <p
                      key={activeCue.id}
                      style={previewStyles.text}
                      className="whitespace-pre-line line-clamp-2"
                    >
                      {useKaraoke
                        ? activeCue.words!.map((word, index) => {
                            const active =
                              currentTime >= word.start &&
                              currentTime < word.end;
                            const label = applyCaptionCapitalization(
                              word.word,
                              captionAppearance.capitalization
                            );
                            return (
                              <span key={`${activeCue.id}-${index}`}>
                                <span
                                  style={{
                                    color: active
                                      ? captionAppearance.highlightColor
                                      : captionAppearance.color,
                                  }}
                                >
                                  {label}
                                </span>
                                {index < activeCue.words!.length - 1 ? " " : ""}
                              </span>
                            );
                          })
                        : displayText}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </LookVideoStage>
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
            seekVideo(timeFromClientX(e.clientX));
          }}
        >
          <div
            className="absolute inset-y-0 bg-[var(--color-accent)]/25"
            style={{
              left: `${startPct}%`,
              width: `${Math.max(1, endPct - startPct)}%`,
            }}
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
            Show &amp; burn captions
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
            {!chunksLoading && includeCaptions ? ` · ${cues.length}` : ""}
          </p>
          {!includeCaptions ? (
            <p className="text-xs text-[var(--color-muted)]">
              Captions are off for this export.
            </p>
          ) : chunksLoading ? (
            <p className="text-xs text-[var(--color-muted)]">
              Loading transcript…
            </p>
          ) : cues.length === 0 ? (
            <p className="text-xs text-[var(--color-muted)]">
              No caption cues in this trim range. Try widening the in/out
              points, or wait for more transcription.
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
                  <button
                    type="button"
                    className="mb-1 text-[10px] text-[var(--color-muted)] hover:text-[var(--color-accent)]"
                    onClick={() => seekVideo(cue.startTimeSeconds)}
                  >
                    {formatSeconds(cue.startTimeSeconds)}–
                    {formatSeconds(cue.endTimeSeconds)}
                  </button>
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
