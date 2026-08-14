"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  Crosshair,
  DiamondPlus,
  RotateCcw,
  Trash2,
} from "lucide-react";
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
  captionAnimationClass,
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
import { CaptionCueText } from "@/components/CaptionCueText";
import {
  previewCameraFrameAt,
  type PreviewCropKeyframe,
} from "@/lib/reframePlayback";
import type { VerticalLayout } from "@/lib/verticalLayout";
import type {
  CropInterpolation,
  ManualReframeKeyframe,
} from "@/lib/professionalReframe";

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
  faceKeyframes?: PreviewCropKeyframe[];
  faceBaseCropWidth?: number | null;
  autoResolvedLayout?: VerticalLayout | null;
  manualCameraKeyframeCount?: number;
  onAddCameraKeyframe?: (keyframe: ManualReframeKeyframe) => void;
  onDeleteCameraKeyframe?: (relativeTime: number) => void;
  onResetCameraKeyframes?: () => void;
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
  faceBaseCropWidth = null,
  autoResolvedLayout = null,
  manualCameraKeyframeCount = 0,
  onAddCameraKeyframe,
  onDeleteCameraKeyframe,
  onResetCameraKeyframes,
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
  const [cameraInterpolation, setCameraInterpolation] =
    useState<CropInterpolation>("ease_in_out");
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
        }>(
          `/api/sessions/${sessionId}/events?start=${encodeURIComponent(
            Math.max(0, clip.startTimeSeconds - 120)
          )}&end=${encodeURIComponent(clip.endTimeSeconds + 120)}`
        ),
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
  }, [
    sessionId,
    clip.id,
    clip.startTimeSeconds,
    clip.endTimeSeconds,
  ]);

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

  const trackedCameraFrame = useMemo(
    () =>
      previewCameraFrameAt(
        faceKeyframes,
        Math.max(0, currentTime - clip.startTimeSeconds)
      ),
    [faceKeyframes, currentTime, clip.startTimeSeconds]
  );
  const needsFaceTracking = getContentLookPreset(lookPreset).needsFaceAnalysis;
  const effectiveLayout =
    (lookPreset === "auto" ? autoResolvedLayout : null) ??
    getContentLookPreset(lookPreset).layout;
  const usesVirtualCamera = effectiveLayout === "subject_aware_crop";
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
    trackedCameraFrame?.centerX ??
    (browserFaceRect
      ? browserFaceRect.x + browserFaceRect.width / 2
      : null);
  const effectiveFaceCenterY = trackedCameraFrame?.centerY ?? null;
  const effectiveZoom =
    faceBaseCropWidth && trackedCameraFrame?.cropWidth
      ? Math.min(
          1.35,
          Math.max(1, faceBaseCropWidth / trackedCameraFrame.cropWidth)
        )
      : 1;

  const addCameraKeyframe = useCallback(
    (patch: Partial<ManualReframeKeyframe> = {}) => {
      if (!onAddCameraKeyframe) return;
      const baseWidth =
        trackedCameraFrame?.cropWidth ?? faceBaseCropWidth ?? 0.316;
      const baseHeight = trackedCameraFrame?.cropHeight ?? 1;
      const cropWidth = Math.min(
        1,
        Math.max(0.05, patch.cropWidth ?? baseWidth)
      );
      const cropHeight = Math.min(
        1,
        Math.max(0.05, patch.cropHeight ?? baseHeight)
      );
      onAddCameraKeyframe({
        timestampSeconds: Math.max(0, currentTime - clip.startTimeSeconds),
        centerX: Math.min(
          1 - cropWidth / 2,
          Math.max(
            cropWidth / 2,
            patch.centerX ?? effectiveFaceCenterX ?? 0.5
          )
        ),
        centerY: Math.min(
          1 - cropHeight / 2,
          Math.max(
            cropHeight / 2,
            patch.centerY ?? effectiveFaceCenterY ?? 0.5
          )
        ),
        cropWidth,
        cropHeight,
        interpolation: patch.interpolation ?? cameraInterpolation,
      });
    },
    [
      cameraInterpolation,
      clip.startTimeSeconds,
      currentTime,
      effectiveFaceCenterX,
      effectiveFaceCenterY,
      faceBaseCropWidth,
      onAddCameraKeyframe,
      trackedCameraFrame,
    ]
  );

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

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{clip.title}</h2>
        <p className="text-xs text-[var(--color-muted)]">
          One preview — look + captions update live. Drag the handles to trim.
        </p>
        <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-muted)]">
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
            faceCenterY={effectiveFaceCenterY}
            zoom={effectiveZoom}
            layoutOverride={lookPreset === "auto" ? autoResolvedLayout : null}
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
                  {activeCue && activeCue.text ? (
                    <p
                      key={activeCue.id}
                      style={previewStyles.text}
                      className={`whitespace-pre-line break-words ${captionAnimationClass(
                        captionAppearance.animation
                      )}`}
                    >
                      <CaptionCueText
                        cue={activeCue}
                        currentTime={currentTime}
                        appearance={captionAppearance}
                      />
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </LookVideoStage>
        </div>
      </div>

      {usesVirtualCamera && hasServerTracking && onAddCameraKeyframe && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] p-2">
          <div
            className="flex h-8 items-center rounded-md border border-[var(--color-card-border)] bg-[var(--color-secondary)] p-0.5"
            role="group"
            aria-label="Camera keyframe transition"
          >
            {(
              [
                ["ease_in_out", "Move"],
                ["cut", "Cut"],
                ["hold", "Hold"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setCameraInterpolation(value)}
                className={cn(
                  "h-7 rounded px-2 text-[10px] font-semibold transition-colors",
                  cameraInterpolation === value
                    ? "bg-[var(--color-foreground)] text-[var(--color-background)]"
                    : "text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex h-8 items-center rounded-md border border-[var(--color-card-border)] bg-[var(--color-secondary)] p-0.5">
            <button
              type="button"
              onClick={() =>
                addCameraKeyframe({
                  centerX: (effectiveFaceCenterX ?? 0.5) - 0.05,
                })
              }
              className="flex h-7 w-7 items-center justify-center rounded text-[var(--color-muted)] hover:bg-[var(--color-card)] hover:text-[var(--color-foreground)]"
              aria-label="Nudge camera left and add keyframe"
              title="Nudge camera left"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => addCameraKeyframe({ centerX: 0.5 })}
              className="flex h-7 w-7 items-center justify-center rounded text-[var(--color-muted)] hover:bg-[var(--color-card)] hover:text-[var(--color-foreground)]"
              aria-label="Recenter camera and add keyframe"
              title="Recenter camera"
            >
              <Crosshair className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() =>
                addCameraKeyframe({
                  centerX: (effectiveFaceCenterX ?? 0.5) + 0.05,
                })
              }
              className="flex h-7 w-7 items-center justify-center rounded text-[var(--color-muted)] hover:bg-[var(--color-card)] hover:text-[var(--color-foreground)]"
              aria-label="Nudge camera right and add keyframe"
              title="Nudge camera right"
            >
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => addCameraKeyframe()}
            className="flex h-8 items-center gap-1.5 rounded-md bg-[var(--color-accent)] px-2.5 text-[11px] font-semibold text-[var(--color-accent-foreground)] hover:bg-[var(--color-accent-hover)]"
          >
            <DiamondPlus className="h-3.5 w-3.5" />
            Add keyframe
          </button>

          <div className="ml-auto flex items-center gap-1">
            <span className="mr-1 text-[10px] font-medium text-[var(--color-muted)]">
              {manualCameraKeyframeCount} manual
            </span>
            <button
              type="button"
              disabled={manualCameraKeyframeCount === 0}
              onClick={() =>
                onDeleteCameraKeyframe?.(
                  Math.max(0, currentTime - clip.startTimeSeconds)
                )
              }
              className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--color-muted)] hover:bg-[var(--color-secondary)] hover:text-[var(--color-foreground)] disabled:opacity-35"
              aria-label="Delete nearest manual camera keyframe"
              title="Delete nearest keyframe"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              disabled={manualCameraKeyframeCount === 0}
              onClick={onResetCameraKeyframes}
              className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--color-muted)] hover:bg-[var(--color-secondary)] hover:text-[var(--color-foreground)] disabled:opacity-35"
              aria-label="Reset camera framing to Auto"
              title="Reset to Auto"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

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
          className="relative h-10 cursor-pointer rounded bg-[var(--color-secondary)]"
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
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-muted)]">
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
                        className="w-full rounded border border-[var(--color-card-border)] bg-[var(--color-background)] p-2 text-xs text-[var(--color-foreground)] focus:border-[var(--color-accent)] focus:outline-none"
                        rows={2}
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="rounded bg-[var(--color-accent)] px-2 py-1 text-[10px] font-semibold text-[var(--color-accent-foreground)]"
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
