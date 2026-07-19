"use client";

import { useEffect, useRef, useState } from "react";
import posthog from "posthog-js";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Link2,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { formatSeconds, formatDuration } from "@/lib/time";
import { fetchJson } from "@/lib/apiClient";
import { isAbortError, saveClip, renderClip } from "@/lib/clipActions";
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
import type { BillingAccountSummary } from "@/services/billingService";
import {
  sequenceBounds,
  sequenceDuration,
  type EditorState,
} from "@/lib/editorState";
import {
  VerticalLayoutPicker,
  defaultVerticalLayoutSelection,
  type VerticalLayoutSelection,
} from "@/components/VerticalLayoutPicker";

interface RenderClipModalProps {
  open: boolean;
  onClose: () => void;
  sessionId: string;
  selection: ClipSelection;
  includeCaptions?: boolean;
  captionAppearance?: CaptionAppearance;
  captionCues?: CaptionCue[];
  editorState?: EditorState;
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
  editorState,
  onClipCreated,
}: RenderClipModalProps) {
  const [mounted, setMounted] = useState(false);
  const [phase, setPhase] = useState<Phase>("configure");
  const [exportStep, setExportStep] = useState<ExportStep>("saving");
  const [exportProgress, setExportProgress] = useState(0);
  const [format, setFormat] = useState<RenderFormat>("vertical");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [burnCaptions, setBurnCaptions] = useState(true);
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
  const [betaAccess, setBetaAccess] = useState(false);
  const [verticalLayout, setVerticalLayout] = useState<VerticalLayoutSelection>(
    defaultVerticalLayoutSelection
  );
  const exportAbortRef = useRef<AbortController | null>(null);
  const prevOpenRef = useRef(false);
  /** Snapshot of selection taken when the modal opens. */
  const openSelectionRef = useRef(selection);

  const sequence = editorState?.segments ?? [];
  const bounds = sequenceBounds(sequence);
  const effectiveSelection = bounds ?? selection;
  const duration =
    sequence.length > 0 ? sequenceDuration(sequence) : selection.end - selection.start;
  const maxClipSeconds = betaAccess ? 60 : MAX_CLIP_SECONDS;
  const canRender =
    duration >= MIN_CLIP_SECONDS && duration <= maxClipSeconds;
  const tooLong = duration > maxClipSeconds;
  const isExporting = phase === "exporting";

  useEffect(() => {
    setMounted(true);
    void fetchJson<{ account: BillingAccountSummary | null }>("/api/auth/me").then(
      ({ data }) => setBetaAccess(Boolean(data.account?.betaAccess))
    );
  }, []);

  // Only reset the form when the modal newly opens — never mid-export when
  // selection / caption props churn from the timeline behind the dialog.
  useEffect(() => {
    const justOpened = open && !prevOpenRef.current;
    prevOpenRef.current = open;
    if (!justOpened) return;

    openSelectionRef.current = bounds ?? selection;
    setPhase("configure");
    setExportStep("saving");
    setExportProgress(0);
    setFormat("vertical");
    setVerticalLayout(defaultVerticalLayoutSelection());
    setTitle(`Clip ${formatSeconds((bounds ?? selection).start)}`);
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
  }, [open, bounds, selection, includeCaptions]);

  useEffect(() => {
    if (!open) return;
    document.body.dataset.renderModalOpen = "true";
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      delete document.body.dataset.renderModalOpen;
      document.body.style.overflow = prev;
      // Do not abort here — Strict Mode remounts must not cancel an encode.
    };
  }, [open]);

  // Soft progress while ffmpeg sits near 55% with no granular updates.
  useEffect(() => {
    if (!isExporting || exportStep !== "rendering") return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const elapsedSec = (Date.now() - startedAt) / 1000;
      const expectedSec = Math.max(
        8,
        duration * (format === "vertical" ? 2.5 : 1.2) * (burnCaptions ? 1.4 : 1)
      );
      setExportProgress((prev) => {
        if (prev < 55 || prev >= 95) return prev;
        const soft = 55 + (92 - 55) * Math.min(0.92, elapsedSec / expectedSec);
        return Math.max(prev, soft);
      });
    }, 800);
    return () => window.clearInterval(timer);
  }, [isExporting, exportStep, format, burnCaptions, duration]);

  if (!open || !mounted) return null;

  const hashtags = tagsText
    .split(/[,\s]+/)
    .map(normalizeHashtag)
    .filter(Boolean);

  const uploadCopy: ClipMetadata = {
    title: title.trim() || `Clip ${formatSeconds(effectiveSelection.start)}`,
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
            startTimeSeconds: effectiveSelection.start,
            endTimeSeconds: effectiveSelection.end,
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
    exportAbortRef.current?.abort();
    const abort = new AbortController();
    exportAbortRef.current = abort;
    const renderSelection = openSelectionRef.current;
    setPhase("exporting");
    setExportStep("saving");
    setExportProgress(0);
    setError(null);
    posthog.capture("clip_render_started", {
      format,
      duration_seconds: duration,
      burn_captions: burnCaptions,
      path: "export",
    });
    try {
      const clipTitle =
        title.trim() || `Clip ${formatSeconds(renderSelection.start)}`;
      const clip = await saveClip(sessionId, renderSelection, clipTitle);

      setExportStep("rendering");
      const result = await renderClip(
        clip.id,
        format,
        burnCaptions,
        captionAppearance,
        burnCaptions
          ? captionCues.filter((cue) =>
              sequence.length > 0
                ? sequence.some(
                    (segment) =>
                      cue.startTimeSeconds <= segment.sourceEnd &&
                      cue.endTimeSeconds >= segment.sourceStart
                  )
                : cue.startTimeSeconds <= renderSelection.end &&
                  cue.endTimeSeconds >= renderSelection.start
            )
          : undefined,
        (update) => {
          if (abort.signal.aborted) return;
          setExportProgress((prev) => Math.max(prev, update.progress));
          setExportStep("rendering");
        },
        editorState,
        abort.signal,
        format === "vertical"
          ? { ...verticalLayout, captions: { ...verticalLayout.captions, enabled: burnCaptions } }
          : undefined
      );

      if (abort.signal.aborted) return;

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
        path: "export",
      });
      onClipCreated?.();
    } catch (err) {
      if (abort.signal.aborted || isAbortError(err)) {
        setError("Export cancelled");
        setPhase("configure");
        setExportProgress(0);
        return;
      }
      setError(err instanceof Error ? err.message : "Render failed");
      setPhase("configure");
      setExportProgress(0);
    } finally {
      if (exportAbortRef.current === abort) exportAbortRef.current = null;
    }
  }

  function cancelExport() {
    exportAbortRef.current?.abort();
    exportAbortRef.current = null;
    setPhase("configure");
    setExportStep("saving");
    setExportProgress(0);
    setError("Export cancelled");
  }

  function handleClose() {
    // Never dismiss (or abort) while encoding — that dropped users back to
    // the timeline with a cancelled job and no error.
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
        "editor-shell fixed inset-0 isolate z-[99999] flex items-start justify-center overflow-y-auto p-3 sm:p-4",
        isExporting ? "z-[2147483647] bg-black" : "bg-black/82 backdrop-blur-sm"
      )}
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !isExporting) handleClose();
      }}
    >
      <div
        className={cn(
          "relative z-10 flex w-full flex-col overflow-hidden rounded-lg border border-[var(--color-card-border)] bg-[#050705] shadow-[0_24px_100px_rgba(0,0,0,0.62)]",
          phase === "configure" && format === "vertical" ? "max-w-xl" : "max-w-lg",
          isExporting && "min-h-[360px]"
        )}
        // Definite height (not just max-height) so the middle pane can scroll
        // and the Export footer stays pinned on screen.
        style={{
          maxHeight: "calc(100dvh - 1.5rem)",
          height:
            phase === "configure" && format === "vertical"
              ? "calc(100dvh - 1.5rem)"
              : undefined,
        }}
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
                ? "Clip ready"
                : isExporting
                  ? "Exporting…"
                  : "Export clip"}
            </h2>
            <p className="mt-0.5 font-mono text-xs tabular-nums text-[var(--color-muted)]">
              {sequence.length > 0
                ? `${sequence.length} cuts / ${formatDuration(duration)}`
                : `${formatSeconds(effectiveSelection.start)} to ${formatSeconds(effectiveSelection.end)} (${formatDuration(duration)})`}
            </p>
          </div>
          <button
            type="button"
            onClick={isExporting ? cancelExport : handleClose}
            className="rounded-md p-1 text-[var(--color-muted)] hover:bg-[#070a07] hover:text-white"
            aria-label={isExporting ? "Cancel export" : "Close"}
            title={isExporting ? "Cancel export" : "Close"}
          >
            <X className="h-4 w-4" strokeWidth={2.25} />
          </button>
        </div>

        <div
          className={cn(
            "relative min-h-0 flex-1 px-4 py-4",
            phase === "configure" && "overflow-y-auto overscroll-contain space-y-4",
            isExporting && "flex items-center justify-center overflow-hidden",
            phase === "done" && "overflow-y-auto overscroll-contain space-y-4"
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
                    active={format === "vertical"}
                    onClick={() => setFormat("vertical")}
                    label="Vertical"
                    sublabel="9:16 · Shorts & Reels"
                    orientation="vertical"
                  />
                  <AspectOption
                    active={format === "native"}
                    onClick={() => setFormat("native")}
                    label="Landscape"
                    sublabel="16:9 · full frame"
                    orientation="horizontal"
                  />
                </div>
              </div>

              {format === "vertical" && (
                <div className="rounded-lg border border-[var(--color-card-border)] bg-[#020302] p-3">
                  <VerticalLayoutPicker
                    sessionId={sessionId}
                    startSeconds={effectiveSelection.start}
                    endSeconds={effectiveSelection.end}
                    value={verticalLayout}
                    onChange={setVerticalLayout}
                    includeCaptions={burnCaptions}
                  />
                </div>
              )}

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={burnCaptions}
                  onChange={(e) => setBurnCaptions(e.target.checked)}
                  className="rounded border-[#444] accent-[var(--color-accent)]"
                />
                <span className="text-xs text-[#dfead8]">
                  Burn captions into the video
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
                    className="inline-flex items-center gap-1 rounded-lg border border-[#21301f] px-2 py-1 text-[10px] font-semibold text-[var(--color-muted)] hover:border-[var(--color-accent)] hover:text-white disabled:opacity-40"
                  >
                    <Sparkles className="h-3 w-3" strokeWidth={2.25} />
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
              burnCaptions={burnCaptions}
            />
          )}

          {phase === "done" && (
            <div className="space-y-5">
              <div className="rounded-xl border border-[var(--color-accent)]/25 bg-[var(--color-accent)]/5 px-4 py-3">
                <p className="text-sm font-semibold text-white">
                  {title.trim() || "Your clip"}
                </p>
                <p className="mt-0.5 text-[11px] text-[var(--color-muted)]">
                  {format === "vertical" ? "Vertical 9:16" : "Landscape 16:9"}
                  {burnCaptions ? " · captions burned in" : ""}
                  {" · "}
                  {formatDuration(duration)}
                </p>
              </div>

              {downloadUrl && (
                <button
                  type="button"
                  onClick={() => downloadClipFile(downloadUrl, downloadFilename)}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--color-accent)] px-4 py-3 text-sm font-semibold text-black hover:bg-[var(--color-accent-hover)]"
                >
                  {downloadDone ? (
                    <Check className="h-4 w-4" strokeWidth={2.5} />
                  ) : (
                    <Download className="h-4 w-4" strokeWidth={2.5} />
                  )}
                  {downloadDone ? "Download again" : "Download MP4"}
                </button>
              )}

              {clipId && (
                <section className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Link2 className="h-3.5 w-3.5 text-[var(--color-muted)]" strokeWidth={2.25} />
                    <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-muted)]">
                      Share
                    </h3>
                  </div>
                  <p className="text-[11px] leading-4 text-[#7a8578]">
                    Send a link so someone can watch or download this clip.
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => void copyShareLink()}
                      className="flex items-center justify-center gap-2 rounded-xl border border-[#21301f] bg-[#070a07] px-3 py-2.5 text-xs font-semibold text-white hover:border-[var(--color-accent)]"
                    >
                      {linkCopied ? (
                        <Check className="h-3.5 w-3.5 text-[var(--color-accent)]" strokeWidth={2.5} />
                      ) : (
                        <Copy className="h-3.5 w-3.5" strokeWidth={2.25} />
                      )}
                      {linkCopied ? "Copied" : "Copy link"}
                    </button>
                    <Link
                      href={`/clips/${clipId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-2 rounded-xl border border-[#21301f] bg-[#070a07] px-3 py-2.5 text-xs font-semibold text-white hover:border-[var(--color-accent)]"
                    >
                      <ExternalLink className="h-3.5 w-3.5" strokeWidth={2.25} />
                      Preview
                    </Link>
                  </div>
                </section>
              )}

              <section className="space-y-2">
                <div className="flex items-center gap-2">
                  <Send className="h-3.5 w-3.5 text-[var(--color-muted)]" strokeWidth={2.25} />
                  <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-muted)]">
                    Publish
                  </h3>
                </div>
                <p className="text-[11px] leading-4 text-[#7a8578]">
                  Post this clip to your connected social accounts.
                </p>

                {clipId && (
                  <Link
                    href={`/clips/${clipId}/publish`}
                    className="flex w-full items-center gap-3 rounded-xl border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-3 py-3 text-left transition-colors hover:bg-[var(--color-accent)]/15"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--color-accent)]/20 text-[var(--color-accent)]">
                      <Send className="h-4 w-4" strokeWidth={2.25} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-white">
                        Open publish workspace
                      </span>
                      <span className="mt-0.5 block text-[10px] text-[var(--color-muted)]">
                        Connect accounts and post with official APIs
                      </span>
                    </span>
                    <ExternalLink className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted)]" />
                  </Link>
                )}

                <div className="space-y-1.5 pt-1">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-[#5f6b5c]">
                    Or upload manually
                  </p>
                  {suggestedDestinations(format).map((destination) => (
                    <button
                      key={destination}
                      type="button"
                      disabled={publishBusy !== null}
                      onClick={() => void handlePublish(destination)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors disabled:opacity-50",
                        destination === "youtube"
                          ? "border-red-500/30 bg-red-500/10 hover:bg-red-500/15"
                          : "border-[#21301f] bg-[#070a07] hover:border-[#3a4a38]"
                      )}
                    >
                      <PlatformGlyph platform={destination} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-white">
                          {publishBusy === destination
                            ? "Opening…"
                            : destinationLabel(destination)}
                        </span>
                        <span className="mt-0.5 block text-[10px] text-[var(--color-muted)]">
                          Copies caption & opens upload page
                        </span>
                      </span>
                    </button>
                  ))}
                </div>

                {clipId && (
                  <Link
                    href={`/clips/${clipId}/export`}
                    className="mt-1 flex items-center justify-center gap-1.5 text-[11px] text-[var(--color-muted)] hover:text-[var(--color-accent)]"
                  >
                    More platform export packs
                    <ExternalLink className="h-3 w-3" strokeWidth={2.25} />
                  </Link>
                )}
              </section>

              {publishStatus && (
                <p className="text-[11px] text-[var(--color-accent)]">{publishStatus}</p>
              )}
            </div>
          )}

          {tooLong && !betaAccess && phase === "configure" && (
            <p className="text-xs text-[var(--color-danger)]">
              Clips must be {formatMaxClipLabel()} or shorter - shorten the
              timeline selection.
            </p>
          )}
          {tooLong && betaAccess && phase === "configure" && (
            <p className="text-xs text-[var(--color-danger)]">
              Creator Beta clips must be 60 seconds or shorter - shorten the
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
                Export
              </button>
            </>
          )}
          {isExporting && (
            <>
              <p className="mr-auto self-center text-[11px] text-[var(--color-muted)]">
                {burnCaptions || format === "vertical"
                  ? "Vertical / captions re-encode — often 1–3 minutes. Keep this open."
                  : "Keep this open until export finishes."}
              </p>
              <button
                type="button"
                onClick={cancelExport}
                className="rounded-lg px-3 py-2 text-xs font-semibold text-[var(--color-muted)] hover:bg-[#070a07] hover:text-white"
              >
                Cancel export
              </button>
            </>
          )}
          {phase === "done" && (
            <button
              type="button"
              onClick={handleClose}
              className="rounded-lg border border-[#21301f] bg-[#070a07] px-4 py-2 text-xs font-semibold text-white hover:border-[var(--color-accent)]"
            >
              Done
            </button>
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
  burnCaptions,
}: {
  step: ExportStep;
  progress: number;
  format: RenderFormat;
  durationSeconds: number;
  burnCaptions: boolean;
}) {
  const needsEncode = format === "vertical" || burnCaptions;
  const cuttingDetail =
    progress < 25
      ? "Preparing source…"
      : progress < 55
        ? "Locating clip range…"
        : needsEncode
          ? `Re-encoding · ${formatDuration(durationSeconds)}`
          : `Stream copy · ${formatDuration(durationSeconds)}`;

  const encodeDetail = burnCaptions
    ? `Encoding ${format === "vertical" ? "9:16" : "16:9"} with captions · ${formatDuration(durationSeconds)}`
    : `Encoding ${format === "vertical" ? "9:16" : "16:9"} · ${formatDuration(durationSeconds)}`;

  const steps: Array<{ id: ExportStep; label: string; detail: string }> = [
    { id: "saving", label: "Save clip", detail: "Storing your selection" },
    {
      id: "rendering",
      label: needsEncode ? "Encoding" : "Cutting",
      detail: needsEncode ? encodeDetail : cuttingDetail,
    },
  ];

  const active = steps.find((s) => s.id === step) ?? steps[0];

  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-6 py-4 text-center">
      <LoadingCircle size="lg" />

      <div className="space-y-1">
        <p className="text-base font-semibold text-white">{active.label}...</p>
        <p className="text-xs text-[var(--color-muted)]">{active.detail}</p>
        {step === "rendering" && needsEncode && progress >= 55 && (
          <p className="pt-1 text-[10px] leading-relaxed text-[#7a8578]">
            Progress may look slow here — the encoder is working.
          </p>
        )}
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
          Longer vertical clips take longer to encode. Landscape without burned
          captions is usually faster.
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

function PlatformGlyph({ platform }: { platform: PublishDestination }) {
  if (platform === "youtube") {
    return (
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-500/15"
        aria-hidden
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="#FF0033">
          <path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2 31.5 31.5 0 0 0 0 12a31.5 31.5 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1A31.5 31.5 0 0 0 24 12a31.5 31.5 0 0 0-.5-5.8zM9.8 15.5v-7l6.2 3.5-6.2 3.5z" />
        </svg>
      </span>
    );
  }

  return (
    <span
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10"
      aria-hidden
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
        <path d="M19.6 7.2a5.1 5.1 0 0 1-3-1v7.1a5.3 5.3 0 1 1-4.6-5.2v2.7a2.6 2.6 0 1 0 1.8 2.5V2.2h2.7a5.1 5.1 0 0 0 3.1 4.9v.1z" />
      </svg>
    </span>
  );
}
