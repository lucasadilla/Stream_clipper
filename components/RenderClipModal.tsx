"use client";

import { useEffect, useState } from "react";
import posthog from "posthog-js";
import { createPortal } from "react-dom";
import Link from "next/link";
import { formatSeconds, formatDuration } from "@/lib/time";
import { fetchJson } from "@/lib/apiClient";
import { saveClip, renderClip } from "@/lib/clipActions";
import { triggerDirectFileDownload } from "@/lib/clientDownload";
import { clipDownloadUrl } from "@/lib/downloadUrls";
import type { ClipSelection } from "@/components/LiveTimeline";
import type { CaptionCue } from "@/lib/captionTrack";
import type { CaptionAppearance } from "@/lib/captionAppearance";
import {
  formatClipMetadataBlock,
  formatHashtags,
  normalizeHashtag,
  type ClipMetadata,
} from "@/lib/clipMetadata";
import { clipShareUrl } from "@/lib/clipShare";
import type { RenderFormat } from "@/lib/renderFormat";
import {
  destinationHint,
  destinationLabel,
  publishHalfStep,
  suggestedDestinations,
  type PublishDestination,
} from "@/lib/publishClip";
import { cn } from "@/lib/cn";
import {
  MIN_CLIP_SECONDS,
  MAX_CLIP_SECONDS,
  formatMaxClipLabel,
} from "@/lib/clipConstants";

interface RenderClipModalProps {
  open: boolean;
  onClose: () => void;
  sessionId: string;
  selection: ClipSelection;
  includeCaptions?: boolean;
  captionAppearance?: CaptionAppearance;
  captionCues?: CaptionCue[];
  onClipCreated?: () => void;
}

type Phase = "configure" | "exporting" | "done";
type ExportStep = "saving" | "rendering";

export function RenderClipModal({
  open,
  onClose,
  sessionId,
  selection,
  includeCaptions = true,
  captionAppearance,
  captionCues = [],
  onClipCreated,
}: RenderClipModalProps) {
  const [mounted, setMounted] = useState(false);
  const [phase, setPhase] = useState<Phase>("configure");
  const [exportStep, setExportStep] = useState<ExportStep>("saving");
  const [exportProgress, setExportProgress] = useState(0);
  const [format, setFormat] = useState<RenderFormat>("native");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [burnCaptions, setBurnCaptions] = useState(includeCaptions);
  const [generatingMeta, setGeneratingMeta] = useState(false);
  const [clipId, setClipId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [publishBusy, setPublishBusy] = useState<PublishDestination | null>(null);
  const [publishStatus, setPublishStatus] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [downloadFilename, setDownloadFilename] = useState("clip.mp4");
  const [downloadDone, setDownloadDone] = useState(false);

  const duration = selection.end - selection.start;
  const canRender =
    duration >= MIN_CLIP_SECONDS && duration <= MAX_CLIP_SECONDS;
  const tooLong = duration > MAX_CLIP_SECONDS;
  const isExporting = phase === "exporting";

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    setPhase("configure");
    setExportStep("saving");
    setExportProgress(0);
    setFormat("native");
    setTitle(`Clip ${formatSeconds(selection.start)}`);
    setDescription("");
    setTagsText("");
    setBurnCaptions(includeCaptions);
    setClipId(null);
    setError(null);
    setCopied(null);
    setPublishStatus(null);
    setLinkCopied(false);
    setDownloadUrl(null);
    setDownloadFilename("clip.mp4");
    setDownloadDone(false);
  }, [open, selection.start, selection.end, includeCaptions]);

  useEffect(() => {
    if (!open) return;
    document.body.dataset.renderModalOpen = "true";
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      delete document.body.dataset.renderModalOpen;
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open || !mounted) return null;

  const hashtags = tagsText
    .split(/[,\s]+/)
    .map(normalizeHashtag)
    .filter(Boolean);

  const uploadCopy: ClipMetadata = {
    title: title.trim() || `Clip ${formatSeconds(selection.start)}`,
    description,
    hashtags,
  };

  async function generateMetadata() {
    if (!canRender) return;
    setGeneratingMeta(true);
    setError(null);
    try {
      const { ok, data } = await fetchJson<ClipMetadata & { error?: string }>(
        `/api/sessions/${sessionId}/clips/metadata`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            startTimeSeconds: selection.start,
            endTimeSeconds: selection.end,
          }),
        }
      );
      if (!ok) throw new Error(data.error ?? "Generation failed");
      setTitle(data.title);
      setDescription(data.description);
      setTagsText(data.hashtags.join(", "));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGeneratingMeta(false);
    }
  }

  function downloadClipFile(url: string, filename: string) {
    setError(null);
    posthog.capture("clip_downloaded", { format });
    triggerDirectFileDownload(url, filename);
    setDownloadDone(true);
  }

  async function handleRender() {
    if (!canRender) return;
    setPhase("exporting");
    setExportStep("saving");
    setExportProgress(0);
    setError(null);
    posthog.capture("clip_render_started", {
      format,
      duration_seconds: duration,
      burn_captions: burnCaptions,
    });
    try {
      const clipTitle = title.trim() || `Clip ${formatSeconds(selection.start)}`;
      const clip = await saveClip(sessionId, selection, clipTitle);

      setExportStep("rendering");
      const result = await renderClip(
        clip.id,
        format,
        burnCaptions,
        captionAppearance,
        captionCues.filter(
          (cue) =>
            cue.startTimeSeconds <= selection.end &&
            cue.endTimeSeconds >= selection.start
        ),
        (update) => {
          setExportProgress(update.progress);
          setExportStep("rendering");
        }
      );

      const url = result.downloadUrl ?? clipDownloadUrl(clip.id);
      const suffix = format === "native" ? "-native" : "-vertical";
      const filename = `${clip.title || "clip"}${suffix}.mp4`;

      setClipId(clip.id);
      setDownloadUrl(url);
      setDownloadFilename(filename);
      setExportProgress(100);
      setPhase("done");
      posthog.capture("clip_exported", {
        format,
        duration_seconds: duration,
        burn_captions: burnCaptions,
      });
      onClipCreated?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Render failed");
      setPhase("configure");
    }
  }

  function handleClose() {
    if (isExporting) return;
    onClose();
  }

  async function copyText(label: string, text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    window.setTimeout(() => setCopied(null), 2000);
  }

  async function copyShareLink() {
    if (!clipId) return;
    await navigator.clipboard.writeText(
      clipShareUrl(clipId, window.location.origin)
    );
    setLinkCopied(true);
    window.setTimeout(() => setLinkCopied(false), 2000);
  }

  async function handlePublish(destination: PublishDestination) {
    setPublishBusy(destination);
    setPublishStatus(null);
    setError(null);
    posthog.capture("clip_publish_opened", { destination, format });
    try {
      const result = await publishHalfStep(destination, uploadCopy, title);
      const label = destinationLabel(destination);
      setPublishStatus(
        result.copied
          ? `Copied upload text - ${label} opened in a new tab`
          : `${label} opened - paste your title manually`
      );
    } catch (err) {
      posthog.captureException(err);
      setError(err instanceof Error ? err.message : "Publish step failed");
    } finally {
      setPublishBusy(null);
    }
  }

  const modal = (
    <div
      className={cn(
        "editor-shell fixed inset-0 isolate flex items-center justify-center p-4 sm:p-6",
        isExporting ? "z-[2147483647] bg-black" : "z-[99999] bg-black/82 backdrop-blur-sm"
      )}
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        className={cn(
          "relative z-10 flex w-full max-w-lg flex-col overflow-hidden rounded-lg border border-[var(--color-card-border)] bg-[#050705] shadow-[0_24px_100px_rgba(0,0,0,0.62)]",
          isExporting ? "min-h-[360px]" : "max-h-[min(92vh,720px)]"
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby="render-modal-title"
        aria-busy={isExporting}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--color-card-border)] bg-[#020302] px-4 py-3">
          <div>
            <h2 id="render-modal-title" className="text-sm font-semibold text-white">
              {phase === "done"
                ? "Export complete"
                : isExporting
                  ? "Exporting clip"
                  : "Render clip"}
            </h2>
            <p className="mt-0.5 font-mono text-xs tabular-nums text-[var(--color-muted)]">
              {formatSeconds(selection.start)} to {formatSeconds(selection.end)} (
              {formatDuration(duration)})
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={isExporting}
            className="px-1 text-lg leading-none text-[var(--color-muted)] hover:text-white disabled:opacity-30 disabled:hover:text-[var(--color-muted)]"
            aria-label="Close"
          >
            x
          </button>
        </div>

        <div
          className={cn(
            "relative flex-1 px-4 py-4",
            phase === "configure" && "overflow-y-auto space-y-4",
            isExporting && "flex items-center justify-center",
            phase === "done" && "overflow-y-auto space-y-4"
          )}
        >
          {generatingMeta && phase === "configure" && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 rounded-lg bg-[#050705]/95">
              <LoadingCircle size="lg" />
              <p className="text-sm text-[#dfead8]">Generating title & tags...</p>
            </div>
          )}
          {phase === "configure" && (
            <>
              <div className="space-y-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-accent)]">
                  Aspect ratio
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <AspectOption
                    active={format === "native"}
                    onClick={() => setFormat("native")}
                    label="Native"
                    sublabel="16:9 / fastest"
                    orientation="horizontal"
                  />
                  <AspectOption
                    active={format === "vertical"}
                    onClick={() => setFormat("vertical")}
                    label="Vertical"
                    sublabel="9:16 / Shorts"
                    orientation="vertical"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={burnCaptions}
                  onChange={(e) => setBurnCaptions(e.target.checked)}
                  className="rounded border-[#444] accent-[var(--color-accent)]"
                />
                <span className="text-xs text-[#dfead8]">
                  Captions visible in export
                </span>
              </label>

              <div className="space-y-3 rounded-lg border border-[var(--color-card-border)] bg-[#020302] p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                    Title & description
                  </span>
                  <button
                    type="button"
                    onClick={() => void generateMetadata()}
                    disabled={!canRender || generatingMeta}
                    className="rounded-lg border border-[#21301f] px-2 py-1 text-[10px] font-semibold text-[var(--color-muted)] hover:border-[var(--color-accent)] hover:text-white disabled:opacity-40"
                  >
                    {generatingMeta ? "Generating..." : "Suggest with AI"}
                  </button>
                </div>

                <label className="block space-y-1">
                  <span className="text-[10px] text-[var(--color-muted)]">Title</span>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Clip title"
                    className="w-full rounded-lg border border-[#21301f] bg-[#070a07] px-3 py-2 text-sm text-white focus:border-[var(--color-accent)] focus:outline-none"
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-[10px] text-[var(--color-muted)]">Description</span>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="One-line description for YouTube / TikTok..."
                    rows={3}
                    className="w-full resize-y rounded-lg border border-[#21301f] bg-[#070a07] px-3 py-2 text-sm text-[#dfead8] focus:border-[var(--color-accent)] focus:outline-none"
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-[10px] text-[var(--color-muted)]">Tags</span>
                  <input
                    value={tagsText}
                    onChange={(e) => setTagsText(e.target.value)}
                    placeholder="shorts, gaming, streamername"
                    className="w-full rounded-lg border border-[#21301f] bg-[#070a07] px-3 py-2 text-sm text-[#dfead8] focus:border-[var(--color-accent)] focus:outline-none"
                  />
                </label>

                {hashtags.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    {hashtags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded border border-[#21301f] bg-[#070a07] px-1.5 py-0.5 text-[10px] text-[var(--color-muted)]"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap gap-1.5 border-t border-[var(--color-card-border)] pt-1">
                  <SmallBtn
                    label="Copy all"
                    onClick={() =>
                      void copyText("all", formatClipMetadataBlock(uploadCopy))
                    }
                  />
                  <SmallBtn
                    label="Copy title"
                    onClick={() => void copyText("title", uploadCopy.title)}
                  />
                  <SmallBtn
                    label="Copy description"
                    onClick={() => void copyText("description", uploadCopy.description)}
                  />
                  <SmallBtn
                    label="Copy tags"
                    disabled={hashtags.length === 0}
                    onClick={() =>
                      void copyText("tags", formatHashtags(hashtags))
                    }
                  />
                </div>
              </div>
            </>
          )}

          {isExporting && (
            <ExportProgress
              step={exportStep}
              progress={exportProgress}
              format={format}
              durationSeconds={duration}
            />
          )}

          {phase === "done" && (
            <div className="space-y-4">
              <p className="text-sm text-[#dfead8]">
                <span className="text-[var(--color-accent)] font-medium">{title}</span>{" "}
                {downloadDone
                  ? "saved on your computer."
                  : "rendered - click Download MP4 to save it to your computer."}
              </p>

              {downloadUrl && (
                <button
                  type="button"
                  onClick={() => downloadClipFile(downloadUrl, downloadFilename)}
                  className="w-full rounded-lg bg-[var(--color-accent)] px-4 py-2.5 text-sm font-semibold text-black hover:bg-[var(--color-accent-hover)]"
                >
                  {downloadDone ? "Download again" : "Download MP4"}
                </button>
              )}

              {description.trim() && (
                <div className="line-clamp-3 rounded-lg border border-[var(--color-card-border)] bg-[#020302] px-3 py-2 text-xs text-[var(--color-muted)]">
                  {description}
                </div>
              )}

              {clipId && (
                <div className="space-y-2 rounded-lg border border-[var(--color-card-border)] bg-[#020302] p-3">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                    Share link
                  </span>
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={`/clips/${clipId}/export`}
                      className="bg-[var(--color-accent)] px-3 py-2 text-[10px] font-bold text-black hover:bg-[var(--color-accent-hover)]"
                    >
                      Export for every platform
                    </Link>
                    <SmallBtn
                      label={linkCopied ? "Copied!" : "Copy link"}
                      onClick={() => void copyShareLink()}
                    />
                    <Link
                      href={`/clips/${clipId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-lg border border-[var(--color-accent)]/50 px-2 py-1 text-[10px] font-semibold text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10"
                    >
                      Open preview
                    </Link>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                  Publish
                </span>
                {suggestedDestinations(format).map((destination) => (
                  <button
                    key={destination}
                    type="button"
                    disabled={publishBusy !== null}
                    onClick={() => void handlePublish(destination)}
                    className={cn(
                      "w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors disabled:opacity-50",
                      destination === "youtube"
                        ? "border-red-500/40 bg-red-500/10 text-white hover:bg-red-500/20"
                        : "border-[#21301f] bg-[#070a07] text-white hover:border-[var(--color-accent)]"
                    )}
                  >
                    {publishBusy === destination
                      ? "Opening..."
                      : `Upload to ${destinationLabel(destination)}`}
                    <span className="mt-0.5 block text-[10px] font-normal text-[var(--color-muted)]">
                      {destinationHint(destination, format)}
                    </span>
                  </button>
                ))}
              </div>

              {publishStatus && (
                <p className="text-[11px] text-[var(--color-accent)]">{publishStatus}</p>
              )}
            </div>
          )}

          {tooLong && phase === "configure" && (
            <p className="text-xs text-[var(--color-danger)]">
              Clips must be {formatMaxClipLabel()} or shorter - shorten the
              timeline selection.
            </p>
          )}
          {error && (
            <p className="text-xs text-[var(--color-danger)]">{error}</p>
          )}
          {copied && phase === "configure" && (
            <p className="text-[11px] text-[var(--color-accent)]">Copied {copied}</p>
          )}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-[var(--color-card-border)] bg-[#020302] px-4 py-3">
          {phase === "configure" && (
            <>
              <button
                type="button"
                onClick={handleClose}
                className="rounded-lg px-3 py-2 text-xs font-semibold text-[var(--color-muted)] hover:bg-[#070a07] hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleRender()}
                disabled={!canRender}
                className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-xs font-semibold text-black hover:bg-[var(--color-accent-hover)] disabled:opacity-40"
              >
                Render clip
              </button>
            </>
          )}
          {isExporting && (
            <p className="mr-auto self-center text-[11px] text-[var(--color-muted)]">
              Please keep this tab open...
            </p>
          )}
          {phase === "done" && (
            <>
              {downloadUrl && (
                <button
                  type="button"
                  onClick={() => downloadClipFile(downloadUrl, downloadFilename)}
                  className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-xs font-semibold text-black hover:bg-[var(--color-accent-hover)]"
                >
                  {downloadDone ? "Download again" : "Download MP4"}
                </button>
              )}
              <button
                type="button"
                onClick={handleClose}
                className="rounded-lg border border-[#21301f] bg-[#070a07] px-4 py-2 text-xs font-semibold text-white hover:border-[var(--color-accent)]"
              >
                Done
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

function ExportProgress({
  step,
  progress,
  format,
  durationSeconds,
}: {
  step: ExportStep;
  progress: number;
  format: RenderFormat;
  durationSeconds: number;
}) {
  const steps: Array<{ id: ExportStep; label: string; detail: string }> = [
    { id: "saving", label: "Save clip", detail: "Storing your selection" },
    {
      id: "rendering",
      label: "Render video",
      detail: `Cutting from local recording / ${format === "vertical" ? "9:16" : "16:9"} / ${formatDuration(durationSeconds)}`,
    },
  ];

  const active = steps.find((s) => s.id === step) ?? steps[0];

  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-6 py-4 text-center">
      <LoadingCircle size="lg" />

      <div className="space-y-1">
        <p className="text-base font-semibold text-white">{active.label}...</p>
        <p className="text-xs text-[var(--color-muted)]">{active.detail}</p>
        <p className="pt-1 text-[11px] tabular-nums text-[var(--color-accent)]">
          {Math.max(0, Math.min(100, Math.round(progress)))}%
        </p>
      </div>

      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#152015]">
        <div
          className="h-full rounded-full bg-[var(--color-accent)] transition-all duration-500 ease-out shadow-[0_0_18px_rgba(149,255,0,0.45)]"
          style={{ width: `${Math.max(8, progress)}%` }}
        />
      </div>

      <ol className="w-full space-y-1.5 text-left">
        {steps.map((item) => {
          const done =
            steps.findIndex((s) => s.id === item.id) <
            steps.findIndex((s) => s.id === step);
          const current = item.id === step;
          return (
            <li
              key={item.id}
              className={cn(
                "flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs",
                current ? "text-white" : done ? "text-[var(--color-muted)]" : "text-[#4f5b4c]"
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 shrink-0 rounded-full",
                  done
                    ? "bg-[var(--color-accent)]"
                    : current
                      ? "bg-[var(--color-accent)] animate-pulse"
                      : "bg-[#444]"
                )}
              />
              {item.label}
            </li>
          );
        })}
      </ol>

      {step === "rendering" && durationSeconds > 60 && (
        <p className="max-w-xs text-[10px] leading-relaxed text-[var(--color-muted)]">
          Longer vertical clips take longer to encode. Native (16:9) without
          captions is fastest.
        </p>
      )}
    </div>
  );
}

function LoadingCircle({
  size = "md",
}: {
  size?: "md" | "lg";
}) {
  const dim = size === "lg" ? "h-20 w-20 border-[5px]" : "h-10 w-10 border-[3px]";
  return (
    <div
      className={cn(
        "animate-spin rounded-full border-[#152015] border-t-[var(--color-accent)]",
        dim
      )}
      role="status"
      aria-label="Loading"
    />
  );
}

function AspectOption({
  active,
  onClick,
  label,
  sublabel,
  orientation,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  sublabel: string;
  orientation: "vertical" | "horizontal";
}) {
  const isVertical = orientation === "vertical";

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-2 rounded-lg border p-3 transition-colors",
        active
          ? "border-[var(--color-accent)] bg-[var(--color-accent)]/14"
          : "border-[#21301f] bg-[#070a07] hover:border-[var(--color-accent)]"
      )}
    >
      <div
        aria-hidden
        className={cn(
          "rounded-[3px] border-2 shrink-0 box-border",
          active
            ? "border-[var(--color-accent)] bg-[var(--color-accent)]/20"
            : "border-[#2d3f2a] bg-[#020302]"
        )}
        style={{
          width: isVertical ? 32 : 56,
          height: isVertical ? 56 : 32,
        }}
      />
      <div className="text-center">
        <span
          className={cn(
            "block text-xs font-semibold",
            active ? "text-[var(--color-accent)]" : "text-[#dfead8]"
          )}
        >
          {label}
        </span>
        <span className="text-[10px] text-[var(--color-muted)]">{sublabel}</span>
      </div>
    </button>
  );
}

function SmallBtn({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg border border-[#21301f] px-2 py-1 text-[10px] font-semibold text-[var(--color-muted)] hover:border-[var(--color-accent)] hover:text-white disabled:opacity-40 disabled:hover:border-[#21301f] disabled:hover:text-[var(--color-muted)]"
    >
      {label}
    </button>
  );
}
