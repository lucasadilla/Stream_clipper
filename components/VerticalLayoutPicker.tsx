"use client";

/**
 * Facecam-aware vertical layout picker for the export modal.
 *
 * Kicks off face analysis for the selected clip range, shows the recommended
 * layout, lets the user pick a layout / face candidate, drag-adjust the
 * detected facecam region, tweak layout settings, and render a short low-res
 * video preview — all before the final 1080×1920 export.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ChevronDown,
  Play,
  RefreshCw,
  ScanFace,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { fetchJson } from "@/lib/apiClient";
import type { NormalizedRect } from "@/lib/normalizedRect";
import type {
  FacecamCandidate,
  FacecamQuality,
  HideOriginalFacecam,
  LayoutRecommendation,
  VerticalLayout,
} from "@/lib/verticalLayout";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VerticalLayoutSelection {
  layout: VerticalLayout;
  faceAnalysisJobId?: string;
  faceSelection: {
    mode: "auto" | "manual";
    trackId?: string;
    manualRect?: NormalizedRect;
  };
  stacked: {
    facecamPosition: "top" | "bottom";
    facecamHeightRatio: number;
    dividerSize: number;
    dividerColor: string;
    hideOriginalFacecam: HideOriginalFacecam;
  };
  pip: {
    position: "top_left" | "top_right" | "bottom_left" | "bottom_right";
    widthRatio: number;
    margin: number;
    borderSize: number;
    borderColor: string;
    hideOriginalFacecam: HideOriginalFacecam;
  };
  subjectCrop: {
    smoothing: number;
    deadZoneRatio: number;
    maxPanSpeed: number;
    fallback: "hold" | "center";
  };
  centerCrop: {
    focalPointX: number;
    zoom: number;
    useBlurredBackground: boolean;
  };
  captions: {
    enabled: boolean;
    position: "upper" | "middle" | "lower";
  };
}

export function defaultVerticalLayoutSelection(): VerticalLayoutSelection {
  return {
    layout: "auto",
    faceSelection: { mode: "auto" },
    stacked: {
      facecamPosition: "top",
      facecamHeightRatio: 0.38,
      dividerSize: 0,
      dividerColor: "#000000",
      hideOriginalFacecam: "none",
    },
    pip: {
      position: "top_right",
      widthRatio: 0.34,
      margin: 0.04,
      borderSize: 3,
      borderColor: "#FFFFFF",
      hideOriginalFacecam: "none",
    },
    subjectCrop: {
      smoothing: 0.35,
      deadZoneRatio: 0.5,
      maxPanSpeed: 0.35,
      fallback: "hold",
    },
    centerCrop: { focalPointX: 0.5, zoom: 1, useBlurredBackground: false },
    captions: { enabled: true, position: "lower" },
  };
}

interface AnalysisView {
  id: string;
  status: string;
  progress: number;
  errorMessage?: string | null;
  classification?: string | null;
  confidence?: number | null;
  sourceWidth?: number;
  sourceHeight?: number;
  primaryCandidate?: FacecamCandidate | null;
  alternativeCandidates?: FacecamCandidate[];
  recommendation?: LayoutRecommendation;
  warnings?: string[];
  frameUrl?: string | null;
}

interface VerticalLayoutPickerProps {
  sessionId: string;
  startSeconds: number;
  endSeconds: number;
  value: VerticalLayoutSelection;
  onChange: (value: VerticalLayoutSelection) => void;
  includeCaptions?: boolean;
  disabled?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ANALYZING_STATUSES = new Set([
  "queued",
  "extracting_frames",
  "detecting_faces",
  "tracking_faces",
  "classifying_layout",
]);

const STATUS_LABELS: Record<string, string> = {
  queued: "Waiting to analyze…",
  extracting_frames: "Reading video frames…",
  detecting_faces: "Looking for faces…",
  tracking_faces: "Tracking faces…",
  classifying_layout: "Working out the layout…",
};

type LayoutCardId =
  | "auto"
  | "facecam_top_gameplay_bottom"
  | "facecam_pip"
  | "subject_aware_crop"
  | "center_crop";

const LAYOUT_CARDS: Array<{
  id: LayoutCardId;
  name: string;
  description: string;
}> = [
  {
    id: "auto",
    name: "Auto",
    description: "Clipper picks the best layout from the detected faces.",
  },
  {
    id: "facecam_top_gameplay_bottom",
    name: "Facecam + Gameplay",
    description: "Stack the facecam and gameplay into a vertical split.",
  },
  {
    id: "facecam_pip",
    name: "Picture in Picture",
    description: "Place the facecam over a full-height gameplay crop.",
  },
  {
    id: "subject_aware_crop",
    name: "Follow speaker",
    description: "Crop to the face of the person who is talking.",
  },
  {
    id: "center_crop",
    name: "Center Crop",
    description: "Use a simple centered vertical crop.",
  },
];

function cardIdForLayout(layout: VerticalLayout): LayoutCardId {
  if (layout === "facecam_bottom_gameplay_top") return "facecam_top_gameplay_bottom";
  if (layout === "facecam_overlay") return "facecam_pip";
  if (layout === "gameplay_full") return "center_crop";
  return layout as LayoutCardId;
}

function qualityLabel(quality: FacecamQuality): string | null {
  if (quality === "low_resolution" || quality === "too_small") {
    return "Facecam quality may be low";
  }
  return null;
}

function classificationLabel(classification?: string | null): string | null {
  switch (classification) {
    case "embedded_facecam":
      return "Stable facecam detected";
    case "moving_subject":
      return "Moving person detected";
    case "multiple_faces":
      return "Multiple faces detected";
    case "no_face":
      return "No reliable face detected";
    default:
      return null;
  }
}

function locationLabel(rect: NormalizedRect): string {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const horizontal = cx < 0.34 ? "left" : cx > 0.66 ? "right" : "center";
  const vertical = cy < 0.34 ? "top" : cy > 0.66 ? "bottom" : "middle";
  if (horizontal === "center" && vertical === "middle") return "center";
  return `${vertical} ${horizontal}`;
}

/** CSS background crop so a candidate thumbnail shows just its region. */
function cropBackgroundStyle(
  frameUrl: string,
  rect: NormalizedRect
): React.CSSProperties {
  const posX = rect.width < 1 ? (rect.x / (1 - rect.width)) * 100 : 0;
  const posY = rect.height < 1 ? (rect.y / (1 - rect.height)) * 100 : 0;
  return {
    backgroundImage: `url(${frameUrl})`,
    backgroundSize: `${100 / rect.width}% ${100 / rect.height}%`,
    backgroundPosition: `${posX}% ${posY}%`,
  };
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function VerticalLayoutPicker({
  sessionId,
  startSeconds,
  endSeconds,
  value,
  onChange,
  includeCaptions,
  disabled,
}: VerticalLayoutPickerProps) {
  const [analysis, setAnalysis] = useState<AnalysisView | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [previewState, setPreviewState] = useState<
    | { phase: "idle" }
    | { phase: "rendering"; progress: number }
    | { phase: "ready"; url: string }
    | { phase: "error"; message: string }
  >({ phase: "idle" });
  const pollAbort = useRef<AbortController | null>(null);

  const analyzing = analysis ? ANALYZING_STATUSES.has(analysis.status) : true;
  const completed = analysis?.status === "completed";
  const failed = analysis?.status === "failed" || Boolean(analysisError);

  const candidates = useMemo(() => {
    if (!analysis) return [] as FacecamCandidate[];
    return [
      ...(analysis.primaryCandidate ? [analysis.primaryCandidate] : []),
      ...(analysis.alternativeCandidates ?? []),
    ];
  }, [analysis]);

  const selectedCandidate = useMemo(() => {
    if (value.faceSelection.trackId) {
      const match = candidates.find(
        (candidate) => candidate.trackId === value.faceSelection.trackId
      );
      if (match) return match;
    }
    return candidates[0];
  }, [candidates, value.faceSelection.trackId]);

  const activeRect: NormalizedRect | undefined =
    value.faceSelection.mode === "manual" && value.faceSelection.manualRect
      ? value.faceSelection.manualRect
      : selectedCandidate?.rect;

  // ------ start + poll analysis ------
  const startAnalysis = useCallback(
    async (force = false) => {
      pollAbort.current?.abort();
      const abort = new AbortController();
      pollAbort.current = abort;
      setAnalysis(null);
      setAnalysisError(null);
      try {
        const { ok, data } = await fetchJson<{
          analysisJobId?: string;
          status?: string;
          error?: string;
        }>(`/api/sessions/${sessionId}/face-analysis`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            startSeconds,
            endSeconds,
            sampleFps: 4,
            force,
          }),
          signal: abort.signal,
        });
        if (!ok || !data.analysisJobId) {
          throw new Error(data.error ?? "Could not start face analysis");
        }
        const jobId = data.analysisJobId;
        onChange({ ...valueRef.current, faceAnalysisJobId: jobId });

        for (let i = 0; i < 240; i++) {
          if (abort.signal.aborted) return;
          const poll = await fetchJson<{ job?: AnalysisView; error?: string }>(
            `/api/face-analysis/${jobId}`,
            { signal: abort.signal }
          );
          if (poll.ok && poll.data.job) {
            setAnalysis(poll.data.job);
            if (!ANALYZING_STATUSES.has(poll.data.job.status)) return;
          }
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
        setAnalysisError("Face analysis is taking too long.");
      } catch (err) {
        if (abort.signal.aborted) return;
        setAnalysisError(
          err instanceof Error ? err.message : "Face analysis failed"
        );
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionId, startSeconds, endSeconds]
  );

  // onChange identity churns each render in the parent; keep a stable ref so
  // the analysis effect doesn't restart mid-poll.
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    void startAnalysis(false);
    return () => pollAbort.current?.abort();
  }, [startAnalysis]);

  const update = useCallback(
    (patch: Partial<VerticalLayoutSelection>) => {
      onChange({ ...valueRef.current, ...patch });
    },
    [onChange]
  );

  const recommendation = analysis?.recommendation;
  const recommendedCard = recommendation
    ? cardIdForLayout(recommendation.layout)
    : null;

  const facecamMissing = completed && candidates.length === 0;
  const facecamQualityWarning = selectedCandidate
    ? qualityLabel(selectedCandidate.quality)
    : null;

  function cardWarning(card: LayoutCardId): string | null {
    if (card === "facecam_top_gameplay_bottom" || card === "facecam_pip") {
      if (facecamMissing) return "No facecam detected";
      if (card === "facecam_top_gameplay_bottom" && selectedCandidate) {
        if (selectedCandidate.quality === "too_small") {
          return `Facecam is only ${selectedCandidate.sourceWidthPixels}×${selectedCandidate.sourceHeightPixels}px — may look blurry`;
        }
        if (selectedCandidate.quality === "low_resolution") {
          return "Facecam quality may be low";
        }
      }
    }
    if (card === "subject_aware_crop" && completed && candidates.length === 0) {
      return "No person detected to follow";
    }
    return null;
  }

  // ------ short video preview ------
  async function generatePreview() {
    setPreviewState({ phase: "rendering", progress: 5 });
    try {
      const { ok, data } = await fetchJson<{ jobId?: string; error?: string }>(
        `/api/sessions/${sessionId}/vertical-preview`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            startSeconds,
            endSeconds,
            verticalLayout: value,
            includeCaptions: includeCaptions ?? false,
          }),
        }
      );
      if (!ok || !data.jobId) {
        throw new Error(data.error ?? "Could not start preview");
      }

      for (let i = 0; i < 120; i++) {
        const poll = await fetchJson<{
          job?: { status: string; progress: number; outputPath?: string | null; errorMessage?: string | null };
          error?: string;
        }>(`/api/render-jobs/${data.jobId}`);
        const job = poll.data.job;
        if (job) {
          if (job.status === "completed" && job.outputPath) {
            setPreviewState({
              phase: "ready",
              url: `/api/storage/${job.outputPath.replace(/\\/g, "/")}?inline=1&v=${Date.now()}`,
            });
            return;
          }
          if (job.status === "failed") {
            throw new Error(job.errorMessage ?? "Preview failed");
          }
          setPreviewState({
            phase: "rendering",
            progress: Math.max(5, job.progress),
          });
        }
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }
      throw new Error("Preview timed out");
    } catch (err) {
      setPreviewState({
        phase: "error",
        message: err instanceof Error ? err.message : "Preview failed",
      });
    }
  }

  const activeCard = cardIdForLayout(value.layout);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-accent)]">
          Vertical layout
        </span>
        {completed && classificationLabel(analysis?.classification) && (
          <span className="inline-flex items-center gap-1 rounded-full border border-[#21301f] bg-[#070a07] px-2 py-0.5 text-[10px] text-[#dfead8]">
            <ScanFace className="h-3 w-3 text-[var(--color-accent)]" strokeWidth={2.25} />
            {classificationLabel(analysis?.classification)}
          </span>
        )}
      </div>

      {analyzing && !failed && (
        <div className="flex items-center gap-3 rounded-lg border border-[#21301f] bg-[#020302] px-3 py-2.5">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#152015] border-t-[var(--color-accent)]" />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-[#dfead8]">
              {STATUS_LABELS[analysis?.status ?? "queued"] ?? "Analyzing clip…"}
            </p>
            <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-[#152015]">
              <div
                className="h-full rounded-full bg-[var(--color-accent)] transition-all duration-500"
                style={{ width: `${Math.max(6, analysis?.progress ?? 0)}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {failed && (
        <div className="space-y-2 rounded-lg border border-[#3d2a1a] bg-[#140d06] px-3 py-2.5">
          <p className="text-xs text-[#e8c9a8]">
            Face analysis didn&apos;t finish
            {analysis?.errorMessage || analysisError
              ? ` — ${analysis?.errorMessage ?? analysisError}`
              : "."}{" "}
            You can still export with Center Crop or select a region manually.
          </p>
          <button
            type="button"
            onClick={() => void startAnalysis(true)}
            className="inline-flex items-center gap-1 rounded-lg border border-[#21301f] px-2 py-1 text-[10px] font-semibold text-[var(--color-muted)] hover:border-[var(--color-accent)] hover:text-white"
          >
            <RefreshCw className="h-3 w-3" strokeWidth={2.25} />
            Retry analysis
          </button>
        </div>
      )}

      {completed && recommendation && (
        <div className="flex items-start gap-2 rounded-lg border border-[var(--color-accent)]/25 bg-[var(--color-accent)]/5 px-3 py-2">
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-accent)]" strokeWidth={2.25} />
          <p className="text-[11px] leading-4 text-[#dfead8]">{recommendation.reason}</p>
        </div>
      )}

      {/* Layout cards */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {LAYOUT_CARDS.map((card) => (
          <LayoutCard
            key={card.id}
            card={card}
            active={activeCard === card.id}
            recommended={recommendedCard === card.id}
            warning={cardWarning(card.id)}
            disabled={disabled}
            onClick={() => update({ layout: card.id })}
          />
        ))}
      </div>

      {/* Face candidate selector */}
      {completed && candidates.length > 1 && analysis?.frameUrl && (
        <div className="space-y-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
            Detected faces
          </span>
          <div className="flex flex-wrap gap-2">
            {candidates.map((candidate, index) => {
              const selected =
                value.faceSelection.mode !== "manual" &&
                (value.faceSelection.trackId
                  ? value.faceSelection.trackId === candidate.trackId
                  : index === 0);
              const bestSpeaker =
                candidates.reduce(
                  (best, c) =>
                    (c.speakingScore ?? 0) > (best?.speakingScore ?? 0) ? c : best,
                  candidates[0]
                )?.trackId === candidate.trackId &&
                (candidate.speakingScore ?? 0) >= 0.2;
              return (
                <button
                  key={candidate.trackId}
                  type="button"
                  disabled={disabled}
                  onClick={() =>
                    update({
                      faceSelection: { mode: "auto", trackId: candidate.trackId },
                    })
                  }
                  className={cn(
                    "flex w-[104px] flex-col items-center gap-1 rounded-lg border p-1.5 transition-colors",
                    selected
                      ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10"
                      : "border-[#21301f] bg-[#070a07] hover:border-[var(--color-accent)]"
                  )}
                >
                  <div
                    className="h-14 w-full rounded-md bg-cover bg-center"
                    style={cropBackgroundStyle(analysis.frameUrl!, candidate.rect)}
                  />
                  <span className="text-[10px] font-semibold text-[#dfead8]">
                    {bestSpeaker
                      ? "Likely speaking"
                      : index === 0
                        ? "Best match"
                        : `Face ${index + 1}`}
                  </span>
                  <span className="text-[9px] leading-3 text-[var(--color-muted)]">
                    {locationLabel(candidate.rect)} ·{" "}
                    {Math.round(candidate.confidence * 100)}%
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Warnings */}
      {(facecamQualityWarning ||
        (analysis?.warnings?.length ?? 0) > 0 ||
        facecamMissing) && (
        <ul className="space-y-1">
          {facecamMissing && (
            <WarningLine text="No reliable facecam was detected. You can use Center Crop or manually select a region." />
          )}
          {facecamQualityWarning &&
            selectedCandidate &&
            (activeCard === "facecam_top_gameplay_bottom" ||
              activeCard === "facecam_pip" ||
              activeCard === "auto") && (
              <WarningLine
                text={`The detected facecam is about ${selectedCandidate.sourceWidthPixels}×${selectedCandidate.sourceHeightPixels} pixels and may look blurry when enlarged. Picture in Picture is recommended.`}
              />
            )}
          {analysis?.warnings
            ?.filter(
              (warning) =>
                !facecamMissing ||
                !warning.startsWith("No reliable facecam")
            )
            .map((warning) => <WarningLine key={warning} text={warning} />)}
        </ul>
      )}

      {/* Adjust facecam region */}
      {(completed || value.faceSelection.mode === "manual") &&
        analysis?.frameUrl &&
        activeCard !== "center_crop" &&
        activeCard !== "subject_aware_crop" && (
          <CollapsibleSection
            open={adjustOpen}
            onToggle={() => setAdjustOpen((open) => !open)}
            label="Adjust facecam region"
          >
            <FacecamAdjuster
              frameUrl={analysis.frameUrl}
              rect={
                activeRect ?? { x: 0.7, y: 0.05, width: 0.25, height: 0.25 }
              }
              isManual={value.faceSelection.mode === "manual"}
              disabled={disabled}
              onRectChange={(rect) =>
                update({
                  faceSelection: {
                    mode: "manual",
                    trackId: value.faceSelection.trackId,
                    manualRect: rect,
                  },
                })
              }
              onReset={() =>
                update({
                  faceSelection: {
                    mode: "auto",
                    trackId: value.faceSelection.trackId,
                  },
                })
              }
            />
          </CollapsibleSection>
        )}

      {/* Layout-specific settings */}
      <CollapsibleSection
        open={settingsOpen}
        onToggle={() => setSettingsOpen((open) => !open)}
        label="Layout settings"
      >
        <LayoutSettings
          card={activeCard}
          value={value}
          update={update}
          disabled={disabled}
        />
      </CollapsibleSection>

      {/* Still preview + video preview */}
      <div className="flex items-start gap-3">
        <StillPreview
          frameUrl={analysis?.frameUrl ?? null}
          card={activeCard}
          recommendedCard={recommendedCard}
          value={value}
          facecamRect={activeRect}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {previewState.phase === "ready" ? (
            <video
              src={previewState.url}
              controls
              autoPlay
              muted
              playsInline
              className="max-h-56 w-auto rounded-lg border border-[#21301f] bg-black"
            />
          ) : (
            <p className="text-[10px] leading-4 text-[var(--color-muted)]">
              The left tile shows an instant estimate. Generate a short video
              preview to see the exact crop, layout and captions before the
              final export.
            </p>
          )}
          <button
            type="button"
            disabled={disabled || previewState.phase === "rendering"}
            onClick={() => void generatePreview()}
            className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-[#21301f] bg-[#070a07] px-3 py-1.5 text-[11px] font-semibold text-white hover:border-[var(--color-accent)] disabled:opacity-50"
          >
            <Play className="h-3 w-3" strokeWidth={2.5} />
            {previewState.phase === "rendering"
              ? `Rendering preview… ${Math.round(previewState.progress)}%`
              : previewState.phase === "ready"
                ? "Regenerate preview"
                : "Generate preview"}
          </button>
          {previewState.phase === "error" && (
            <p className="text-[10px] text-[var(--color-danger)]">
              {previewState.message}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Layout card
// ---------------------------------------------------------------------------

function LayoutCard({
  card,
  active,
  recommended,
  warning,
  disabled,
  onClick,
}: {
  card: { id: LayoutCardId; name: string; description: string };
  active: boolean;
  recommended: boolean;
  warning: string | null;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={warning ?? card.description}
      className={cn(
        "relative flex flex-col items-center gap-1.5 rounded-lg border p-2.5 text-center transition-colors",
        active
          ? "border-[var(--color-accent)] bg-[var(--color-accent)]/14"
          : "border-[#21301f] bg-[#070a07] hover:border-[var(--color-accent)]"
      )}
    >
      {recommended && (
        <span className="absolute -top-1.5 right-1.5 rounded-full bg-[var(--color-accent)] px-1.5 py-px text-[8px] font-bold uppercase tracking-wide text-black">
          Recommended
        </span>
      )}
      <LayoutDiagram card={card.id} active={active} />
      <span
        className={cn(
          "text-[11px] font-semibold leading-3",
          active ? "text-[var(--color-accent)]" : "text-[#dfead8]"
        )}
      >
        {card.name}
      </span>
      <span className="line-clamp-2 text-[9px] leading-3 text-[var(--color-muted)]">
        {card.description}
      </span>
      {warning && (
        <span className="rounded border border-[#4a3418] bg-[#1c1206] px-1 py-px text-[8px] font-semibold text-[#e8b06a]">
          {warning}
        </span>
      )}
    </button>
  );
}

function LayoutDiagram({ card, active }: { card: LayoutCardId; active: boolean }) {
  const stroke = active ? "var(--color-accent)" : "#3a4a38";
  const fill = active ? "rgba(149,255,0,0.25)" : "#16211573";
  const frame = { width: 24, height: 42 };
  return (
    <svg
      width={frame.width}
      height={frame.height}
      viewBox={`0 0 ${frame.width} ${frame.height}`}
      aria-hidden
    >
      <rect
        x="0.75"
        y="0.75"
        width={frame.width - 1.5}
        height={frame.height - 1.5}
        rx="2.5"
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
      />
      {card === "auto" && (
        <text
          x={frame.width / 2}
          y={frame.height / 2 + 4}
          textAnchor="middle"
          fontSize="12"
          fontWeight="700"
          fill={stroke}
        >
          A
        </text>
      )}
      {card === "facecam_top_gameplay_bottom" && (
        <>
          <rect x="3" y="3" width="18" height="13" rx="1.5" fill={fill} stroke={stroke} />
          <line x1="2" y1="17.5" x2="22" y2="17.5" stroke={stroke} strokeWidth="1" />
        </>
      )}
      {card === "facecam_pip" && (
        <rect x="12.5" y="4" width="8" height="8" rx="1.5" fill={fill} stroke={stroke} />
      )}
      {card === "subject_aware_crop" && (
        <>
          <circle cx="12" cy="16" r="4.5" fill={fill} stroke={stroke} />
          <path d="M5 33 L12 25 L19 33" fill="none" stroke={stroke} strokeWidth="1.25" />
        </>
      )}
      {card === "center_crop" && (
        <rect x="7" y="10" width="10" height="22" rx="1.5" fill={fill} stroke={stroke} strokeDasharray="2.5 2" />
      )}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Collapsible section
// ---------------------------------------------------------------------------

function CollapsibleSection({
  open,
  onToggle,
  label,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-[#21301f] bg-[#020302]">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)] hover:text-white"
      >
        {label}
        <ChevronDown
          className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")}
          strokeWidth={2.25}
        />
      </button>
      {open && <div className="border-t border-[#152015] px-3 py-3">{children}</div>}
    </div>
  );
}

function WarningLine({ text }: { text: string }) {
  return (
    <li className="flex items-start gap-1.5 text-[10px] leading-4 text-[#e8b06a]">
      <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-[#e8b06a]" />
      {text}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Facecam region adjuster (drag + resize on a representative frame)
// ---------------------------------------------------------------------------

function FacecamAdjuster({
  frameUrl,
  rect,
  isManual,
  disabled,
  onRectChange,
  onReset,
}: {
  frameUrl: string;
  rect: NormalizedRect;
  isManual: boolean;
  disabled?: boolean;
  onRectChange: (rect: NormalizedRect) => void;
  onReset: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [lockAspect, setLockAspect] = useState(false);
  const dragRef = useRef<{
    mode: "move" | "resize";
    pointerId: number;
    startX: number;
    startY: number;
    startRect: NormalizedRect;
    aspect: number;
  } | null>(null);

  const clampRect = (r: NormalizedRect): NormalizedRect => {
    const width = Math.min(1, Math.max(0.04, r.width));
    const height = Math.min(1, Math.max(0.04, r.height));
    return {
      x: Math.min(1 - width, Math.max(0, r.x)),
      y: Math.min(1 - height, Math.max(0, r.y)),
      width,
      height,
    };
  };

  function startDrag(
    e: React.PointerEvent,
    mode: "move" | "resize"
  ) {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = {
      mode,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startRect: rect,
      aspect: rect.width / rect.height,
    };
  }

  function moveDrag(e: React.PointerEvent) {
    const drag = dragRef.current;
    const container = containerRef.current;
    if (!drag || !container || drag.pointerId !== e.pointerId) return;
    const bounds = container.getBoundingClientRect();
    const dx = (e.clientX - drag.startX) / bounds.width;
    const dy = (e.clientY - drag.startY) / bounds.height;

    if (drag.mode === "move") {
      onRectChange(
        clampRect({
          ...drag.startRect,
          x: drag.startRect.x + dx,
          y: drag.startRect.y + dy,
        })
      );
    } else {
      const width = drag.startRect.width + dx;
      const height = lockAspect
        ? width / drag.aspect
        : drag.startRect.height + dy;
      onRectChange(clampRect({ ...drag.startRect, width, height }));
    }
  }

  function endDrag(e: React.PointerEvent) {
    if (dragRef.current?.pointerId === e.pointerId) dragRef.current = null;
  }

  return (
    <div className="space-y-2">
      <div
        ref={containerRef}
        className="relative w-full select-none overflow-hidden rounded-lg border border-[#152015] bg-black"
        style={{ aspectRatio: "16 / 9", touchAction: "none" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={frameUrl}
          alt="Representative video frame"
          className="absolute inset-0 h-full w-full object-contain"
          draggable={false}
        />
        <div
          role="presentation"
          onPointerDown={(e) => startDrag(e, "move")}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className="absolute cursor-move border-2 border-[var(--color-accent)] bg-[var(--color-accent)]/10 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
          style={{
            left: `${rect.x * 100}%`,
            top: `${rect.y * 100}%`,
            width: `${rect.width * 100}%`,
            height: `${rect.height * 100}%`,
          }}
        >
          <span
            role="presentation"
            onPointerDown={(e) => startDrag(e, "resize")}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            className="absolute -bottom-1.5 -right-1.5 h-3.5 w-3.5 cursor-nwse-resize rounded-sm border border-black bg-[var(--color-accent)]"
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex cursor-pointer items-center gap-1.5 text-[10px] text-[#dfead8]">
          <input
            type="checkbox"
            checked={lockAspect}
            onChange={(e) => setLockAspect(e.target.checked)}
            className="rounded border-[#444] accent-[var(--color-accent)]"
          />
          Lock aspect ratio
        </label>
        {isManual && (
          <button
            type="button"
            onClick={onReset}
            className="rounded-lg border border-[#21301f] px-2 py-1 text-[10px] font-semibold text-[var(--color-muted)] hover:border-[var(--color-accent)] hover:text-white"
          >
            Reset to automatic
          </button>
        )}
        <span className="text-[10px] text-[var(--color-muted)]">
          {isManual ? "Manual region" : "Detected automatically"} — drag to
          move, corner to resize
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Layout settings
// ---------------------------------------------------------------------------

function LayoutSettings({
  card,
  value,
  update,
  disabled,
}: {
  card: LayoutCardId;
  value: VerticalLayoutSelection;
  update: (patch: Partial<VerticalLayoutSelection>) => void;
  disabled?: boolean;
}) {
  if (card === "auto") {
    return (
      <p className="text-[10px] leading-4 text-[var(--color-muted)]">
        Auto uses the recommended layout with its default settings. Pick a
        specific layout to customize it.
      </p>
    );
  }

  if (card === "facecam_top_gameplay_bottom") {
    const stacked = value.stacked;
    return (
      <div className="space-y-3">
        <SettingRow label="Facecam position">
          <SegmentedControl
            options={[
              { id: "top", label: "Top" },
              { id: "bottom", label: "Bottom" },
            ]}
            value={stacked.facecamPosition}
            disabled={disabled}
            onChange={(position) =>
              update({
                stacked: { ...stacked, facecamPosition: position as "top" | "bottom" },
                layout:
                  position === "bottom"
                    ? "facecam_bottom_gameplay_top"
                    : "facecam_top_gameplay_bottom",
              })
            }
          />
        </SettingRow>
        <SliderRow
          label="Facecam panel height"
          value={stacked.facecamHeightRatio}
          min={0.2}
          max={0.55}
          step={0.01}
          format={(v) => `${Math.round(v * 100)}%`}
          disabled={disabled}
          onChange={(facecamHeightRatio) =>
            update({ stacked: { ...stacked, facecamHeightRatio } })
          }
        />
        <SettingRow label="Original facecam">
          <HideFacecamSelect
            value={stacked.hideOriginalFacecam}
            disabled={disabled}
            onChange={(hideOriginalFacecam) =>
              update({ stacked: { ...stacked, hideOriginalFacecam } })
            }
          />
        </SettingRow>
      </div>
    );
  }

  if (card === "facecam_pip") {
    const pip = value.pip;
    return (
      <div className="space-y-3">
        <SettingRow label="Position">
          <SegmentedControl
            options={[
              { id: "top_left", label: "Top L" },
              { id: "top_right", label: "Top R" },
              { id: "bottom_left", label: "Bot L" },
              { id: "bottom_right", label: "Bot R" },
            ]}
            value={pip.position}
            disabled={disabled}
            onChange={(position) =>
              update({ pip: { ...pip, position: position as typeof pip.position } })
            }
          />
        </SettingRow>
        <SliderRow
          label="Facecam width"
          value={pip.widthRatio}
          min={0.2}
          max={0.5}
          step={0.01}
          format={(v) => `${Math.round(v * 100)}%`}
          disabled={disabled}
          onChange={(widthRatio) => update({ pip: { ...pip, widthRatio } })}
        />
        <SliderRow
          label="Border"
          value={pip.borderSize}
          min={0}
          max={16}
          step={1}
          format={(v) => `${Math.round(v)}px`}
          disabled={disabled}
          onChange={(borderSize) => update({ pip: { ...pip, borderSize } })}
        />
        <SettingRow label="Original facecam">
          <HideFacecamSelect
            value={pip.hideOriginalFacecam}
            disabled={disabled}
            onChange={(hideOriginalFacecam) =>
              update({ pip: { ...pip, hideOriginalFacecam } })
            }
          />
        </SettingRow>
      </div>
    );
  }

  if (card === "subject_aware_crop") {
    const subject = value.subjectCrop;
    return (
      <div className="space-y-3">
        <SliderRow
          label="Follow speed"
          value={subject.smoothing}
          min={0.05}
          max={1}
          step={0.05}
          format={(v) => (v < 0.3 ? "Gentle" : v < 0.7 ? "Balanced" : "Snappy")}
          disabled={disabled}
          onChange={(smoothing) => update({ subjectCrop: { ...subject, smoothing } })}
        />
        <SliderRow
          label="Dead zone"
          value={subject.deadZoneRatio}
          min={0}
          max={0.8}
          step={0.05}
          format={(v) => `${Math.round(v * 100)}%`}
          disabled={disabled}
          onChange={(deadZoneRatio) =>
            update({ subjectCrop: { ...subject, deadZoneRatio } })
          }
        />
        <SettingRow label="If the person disappears">
          <SegmentedControl
            options={[
              { id: "hold", label: "Hold position" },
              { id: "center", label: "Return to center" },
            ]}
            value={subject.fallback}
            disabled={disabled}
            onChange={(fallback) =>
              update({
                subjectCrop: { ...subject, fallback: fallback as "hold" | "center" },
              })
            }
          />
        </SettingRow>
      </div>
    );
  }

  const center = value.centerCrop;
  return (
    <div className="space-y-3">
      <SliderRow
        label="Focal position"
        value={center.focalPointX}
        min={0}
        max={1}
        step={0.01}
        format={(v) => (v < 0.4 ? "Left" : v > 0.6 ? "Right" : "Center")}
        disabled={disabled}
        onChange={(focalPointX) => update({ centerCrop: { ...center, focalPointX } })}
      />
      <SliderRow
        label="Zoom"
        value={center.zoom}
        min={1}
        max={2}
        step={0.05}
        format={(v) => `${v.toFixed(2)}×`}
        disabled={disabled}
        onChange={(zoom) => update({ centerCrop: { ...center, zoom } })}
      />
      <label className="flex cursor-pointer items-center gap-1.5 text-[10px] text-[#dfead8]">
        <input
          type="checkbox"
          checked={center.useBlurredBackground}
          disabled={disabled}
          onChange={(e) =>
            update({
              centerCrop: { ...center, useBlurredBackground: e.target.checked },
            })
          }
          className="rounded border-[#444] accent-[var(--color-accent)]"
        />
        Blurred background instead of cropping
      </label>
    </div>
  );
}

function SettingRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[10px] text-[var(--color-muted)]">{label}</span>
      {children}
    </div>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  format,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-[var(--color-muted)]">{label}</span>
        <span className="text-[10px] tabular-nums text-[#dfead8]">
          {format(value)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number.parseFloat(e.target.value))}
        className="w-full accent-[var(--color-accent)]"
      />
    </div>
  );
}

function SegmentedControl({
  options,
  value,
  disabled,
  onChange,
}: {
  options: Array<{ id: string; label: string }>;
  value: string;
  disabled?: boolean;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex overflow-hidden rounded-lg border border-[#21301f]">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          disabled={disabled}
          onClick={() => onChange(option.id)}
          className={cn(
            "px-2 py-1 text-[10px] font-semibold transition-colors",
            value === option.id
              ? "bg-[var(--color-accent)] text-black"
              : "bg-[#070a07] text-[var(--color-muted)] hover:text-white"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function HideFacecamSelect({
  value,
  disabled,
  onChange,
}: {
  value: HideOriginalFacecam;
  disabled?: boolean;
  onChange: (value: HideOriginalFacecam) => void;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as HideOriginalFacecam)}
      className="rounded-lg border border-[#21301f] bg-[#070a07] px-2 py-1 text-[10px] text-[#dfead8] focus:border-[var(--color-accent)] focus:outline-none"
    >
      <option value="none">Leave visible</option>
      <option value="blur">Blur it</option>
      <option value="cover">Cover it</option>
      <option value="crop_out">Crop it out</option>
    </select>
  );
}

// ---------------------------------------------------------------------------
// Instant still preview (browser-rendered layout estimate)
// ---------------------------------------------------------------------------

function StillPreview({
  frameUrl,
  card,
  recommendedCard,
  value,
  facecamRect,
}: {
  frameUrl: string | null;
  card: LayoutCardId;
  recommendedCard: LayoutCardId | null;
  value: VerticalLayoutSelection;
  facecamRect?: NormalizedRect;
}) {
  const width = 81;
  const height = 144;
  const effectiveCard =
    card === "auto" ? recommendedCard ?? "center_crop" : card;

  if (!frameUrl) {
    return (
      <div
        className="flex shrink-0 items-center justify-center rounded-lg border border-[#21301f] bg-[#020302] text-[9px] text-[var(--color-muted)]"
        style={{ width, height }}
      >
        Preview
      </div>
    );
  }

  const cover: React.CSSProperties = {
    backgroundImage: `url(${frameUrl})`,
    backgroundSize: "cover",
    backgroundPosition: `${(value.centerCrop.focalPointX ?? 0.5) * 100}% center`,
  };

  const stackedRatio = value.stacked.facecamHeightRatio;
  const facecamOnTop =
    value.layout !== "facecam_bottom_gameplay_top" &&
    value.stacked.facecamPosition !== "bottom";

  const facePanel =
    facecamRect && frameUrl ? cropBackgroundStyle(frameUrl, facecamRect) : cover;

  return (
    <div
      className="relative shrink-0 overflow-hidden rounded-lg border border-[#21301f] bg-black"
      style={{ width, height }}
      aria-label="Layout preview"
    >
      {(effectiveCard === "center_crop" || effectiveCard === "subject_aware_crop") && (
        <div className="absolute inset-0" style={cover} />
      )}

      {effectiveCard === "facecam_top_gameplay_bottom" && (
        <div className="absolute inset-0 flex flex-col">
          {facecamOnTop ? (
            <>
              <div style={{ height: `${stackedRatio * 100}%`, ...facePanel }} />
              <div className="flex-1" style={cover} />
            </>
          ) : (
            <>
              <div className="flex-1" style={cover} />
              <div style={{ height: `${stackedRatio * 100}%`, ...facePanel }} />
            </>
          )}
        </div>
      )}

      {effectiveCard === "facecam_pip" && (
        <div className="absolute inset-0" style={cover}>
          <div
            className="absolute rounded-[3px] border border-white/80"
            style={{
              width: `${value.pip.widthRatio * 100}%`,
              aspectRatio:
                facecamRect
                  ? `${facecamRect.width * 16} / ${facecamRect.height * 9}`
                  : "1 / 1",
              ...(value.pip.position.includes("left")
                ? { left: `${value.pip.margin * 100}%` }
                : { right: `${value.pip.margin * 100}%` }),
              ...(value.pip.position.includes("top")
                ? { top: `${value.pip.margin * 100 + 5}%` }
                : { bottom: `${value.pip.margin * 100 + 14}%` }),
              ...facePanel,
            }}
          />
        </div>
      )}

      <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 py-px text-[8px] font-semibold text-white/80">
        9:16
      </span>
    </div>
  );
}
