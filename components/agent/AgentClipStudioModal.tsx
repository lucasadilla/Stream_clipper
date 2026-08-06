"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { AgentClipEditor } from "@/components/agent/AgentClipEditor";
import {
  LookLayoutMock,
  LookPresetGlyph,
  PlatformChipRow,
  PlatformPhoneFrame,
} from "@/components/agent/AgentStudioPreviews";
import type { ClipSuggestionData } from "@/components/ClipSuggestionCard";
import type { CaptionAppearance } from "@/lib/captionAppearance";
import {
  CONTENT_LOOK_PRESETS,
  getContentLookPreset,
  lookPresetFromLayout,
  type ContentLookPresetId,
} from "@/lib/contentLookPresets";
import {
  defaultVerticalLayoutSelection,
  type VerticalLayoutSelection,
} from "@/components/VerticalLayoutPicker";
import { PLATFORM_PRESETS } from "@/lib/platforms/presets";
import type { PlatformKey } from "@/lib/platforms/types";
import type { SocialPlatform } from "@/lib/social/types";
import { renderClip } from "@/lib/clipActions";
import { triggerFileDownload } from "@/lib/clientDownload";
import { clipThumbnailApiUrl } from "@/lib/downloadUrls";
import { fetchJson } from "@/lib/apiClient";
import { formatSeconds } from "@/lib/time";

type StudioTab = "edit" | "preview" | "export";

const PREVIEW_PLATFORMS: PlatformKey[] = [
  "youtube_shorts",
  "tiktok",
  "instagram_reels",
  "instagram_feed",
  "facebook_reels",
  "x",
  "youtube_landscape",
];

const EXPORT_TO_SOCIAL: Partial<Record<PlatformKey, SocialPlatform>> = {
  youtube_shorts: "youtube",
  youtube_landscape: "youtube",
  tiktok: "tiktok",
  instagram_reels: "instagram",
  instagram_feed: "instagram",
  facebook_reels: "facebook",
  facebook_feed: "facebook",
  x: "x",
};

interface SocialAccount {
  id: string;
  platform: SocialPlatform;
  displayName: string | null;
  username: string | null;
  isActive: boolean;
  isDefault?: boolean;
}

interface AgentClipStudioModalProps {
  open: boolean;
  sessionId: string;
  clip: ClipSuggestionData;
  playbackUrl: string | null;
  sourceDuration: number;
  includeCaptions: boolean;
  captionAppearance: CaptionAppearance;
  onIncludeCaptionsChange: (value: boolean) => void;
  onCaptionAppearanceChange: (value: CaptionAppearance) => void;
  onClipChange: (clip: ClipSuggestionData) => void;
  onClose: () => void;
}

function buildVerticalSelection(
  presetId: ContentLookPresetId,
  faceAnalysisJobId: string | null,
  captionsEnabled: boolean
): VerticalLayoutSelection {
  const preset = getContentLookPreset(presetId);
  const base = defaultVerticalLayoutSelection();
  return {
    ...base,
    layout: preset.layout,
    faceAnalysisJobId: faceAnalysisJobId ?? undefined,
    faceSelection: { mode: "auto" },
    stacked: {
      ...base.stacked,
      facecamPosition: "top",
      hideOriginalFacecam: presetId === "gaming" ? "blur" : "none",
    },
    pip: {
      ...base.pip,
      hideOriginalFacecam: presetId === "podcast" ? "blur" : "none",
    },
    captions: {
      enabled: captionsEnabled,
      position: "lower",
    },
  };
}

export function AgentClipStudioModal({
  open,
  sessionId,
  clip,
  playbackUrl,
  sourceDuration,
  includeCaptions,
  captionAppearance,
  onIncludeCaptionsChange,
  onCaptionAppearanceChange,
  onClipChange,
  onClose,
}: AgentClipStudioModalProps) {
  const [mounted, setMounted] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<StudioTab>("edit");
  const [lookPreset, setLookPreset] = useState<ContentLookPresetId>("auto");
  const [faceJobId, setFaceJobId] = useState<string | null>(null);
  const [faceRect, setFaceRect] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const [faceKeyframes, setFaceKeyframes] = useState<
    Array<{ timestampSeconds: number; centerX: number }>
  >([]);
  const [analyzingFace, setAnalyzingFace] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [faceTrackingReady, setFaceTrackingReady] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const lookGenRef = useRef(0);
  const userChoseLookRef = useRef(false);
  const includeCaptionsRef = useRef(includeCaptions);
  const onCloseRef = useRef(onClose);
  const [previewPlatform, setPreviewPlatform] =
    useState<PlatformKey>("youtube_shorts");
  const [selectedPlatforms, setSelectedPlatforms] = useState<PlatformKey[]>([
    "youtube_shorts",
    "tiktok",
    "instagram_reels",
  ]);
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [rendering, setRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [packing, setPacking] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionOk, setActionOk] = useState<string | null>(null);
  includeCaptionsRef.current = includeCaptions;
  onCloseRef.current = onClose;

  useEffect(() => {
    setMounted(true);
  }, []);

  // Native <video controls> steals wheel (volume). Forward those wheels to the modal scroller.
  useEffect(() => {
    if (!open) return;
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.tagName === "VIDEO" || target.closest("video")) {
        event.preventDefault();
        el.scrollTop += event.deltaY;
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [open, tab]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const initialLookGeneration = ++lookGenRef.current;
    userChoseLookRef.current = false;
    setTab("edit");
    setDownloadUrl(null);
    setActionError(null);
    setActionOk(null);
    setLookPreset("auto");
    setFaceJobId(null);
    setFaceRect(null);
    setFaceKeyframes([]);
    setAnalyzingFace(true);
    setAnalysisProgress(0);
    setFaceTrackingReady(false);
    setAnalysisError(null);

    void (async () => {
      const loadFaceFromJob = async (jobId: string) => {
        const poll = await fetchJson<{
          error?: string;
          job?: {
            status?: string;
            progress?: number;
            errorMessage?: string | null;
            primaryCandidate?: {
              faceRect?: {
                x: number;
                y: number;
                width: number;
                height: number;
              } | null;
              rect?: {
                x: number;
                y: number;
                width: number;
                height: number;
              } | null;
            } | null;
            previewKeyframes?: Array<{
              timestampSeconds: number;
              centerX: number;
            }>;
            warnings?: string[];
          };
        }>(`/api/face-analysis/${jobId}`);
        if (cancelled) return "cancelled" as const;
        if (!poll.ok || !poll.data.job) {
          setAnalyzingFace(false);
          setAnalysisError(
            poll.data.error ?? "Face analysis could not be loaded."
          );
          return "failed" as const;
        }
        const job = poll.data.job;
        setAnalysisProgress(Math.max(0, Math.min(100, job.progress ?? 0)));
        if (job.status === "failed") {
          setAnalyzingFace(false);
          setAnalysisError(
            job.errorMessage ?? "Face analysis failed. Try the clip again."
          );
          return "failed" as const;
        }
        if (job.status !== "completed") {
          setAnalyzingFace(true);
          setAnalysisError(null);
          return "pending" as const;
        }
        const candidate = job.primaryCandidate;
        const rect = candidate?.faceRect ?? candidate?.rect ?? null;
        if (rect) setFaceRect(rect);
        const keyframes = (job.previewKeyframes ?? []).filter(
          (keyframe) =>
            Number.isFinite(keyframe.timestampSeconds) &&
            Number.isFinite(keyframe.centerX)
        );
        setFaceKeyframes(keyframes);
        setAnalyzingFace(false);
        setAnalysisProgress(100);
        setFaceTrackingReady(Boolean(rect || keyframes.length > 0));
        if (!rect && keyframes.length === 0) {
          setAnalysisError(
            job.warnings?.[0] ??
              "No reliable face was found. This look will use a centered crop."
          );
          // Old jobs could be marked completed after decoding zero frames.
          // Request the current analysis once instead of trusting that cache.
          return "empty" as const;
        }
        return "completed" as const;
      };

      const { ok, data } = await fetchJson<{
        configuration?: {
          layout?: string;
          faceAnalysisJobId?: string | null;
        } | null;
      }>(`/api/clips/${clip.id}/vertical-layout`);
      if (ok && data.configuration) {
        if (
          !userChoseLookRef.current &&
          lookGenRef.current === initialLookGeneration
        ) {
          setLookPreset(lookPresetFromLayout(data.configuration.layout));
        }
        if (data.configuration.faceAnalysisJobId) {
          setFaceJobId(data.configuration.faceAnalysisJobId);
          const status = await loadFaceFromJob(
            data.configuration.faceAnalysisJobId
          );
          if (status === "completed") return;
        }
      }

      const face = await fetchJson<{
        analysisJobId?: string;
        status?: string;
        error?: string;
      }>(
        `/api/sessions/${sessionId}/face-analysis`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            startSeconds: clip.startTimeSeconds,
            endSeconds: clip.endTimeSeconds,
            clipSuggestionId: clip.id,
            sampleFps: 2.5,
            priority: true,
          }),
        }
      );
      if (cancelled) return;
      if (!face.ok || !face.data.analysisJobId) {
        setAnalyzingFace(false);
        setAnalysisError(
          face.data.error ?? "Face tracking could not be started."
        );
        return;
      }
      const jobId = face.data.analysisJobId;
      setFaceJobId(jobId);
      setAnalyzingFace(true);
      setAnalysisError(null);
      if (
        !userChoseLookRef.current &&
        lookGenRef.current === initialLookGeneration
      ) {
        await fetchJson(`/api/clips/${clip.id}/vertical-layout`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            buildVerticalSelection(
              "auto",
              jobId,
              includeCaptionsRef.current
            )
          ),
        });
      }

      // Poll briefly so the preview can snap to the detected face.
      for (let i = 0; i < 60; i++) {
        if (cancelled) return;
        const status = await loadFaceFromJob(jobId);
        if (status === "completed" || status === "failed") return;
        await new Promise((r) => setTimeout(r, i < 20 ? 500 : 1000));
      }
      if (!cancelled) {
        setAnalyzingFace(false);
        setAnalysisError(
          "Face tracking is taking too long. Reopen this clip to retry."
        );
      }
    })();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      cancelled = true;
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [
    open,
    clip.id,
    clip.startTimeSeconds,
    clip.endTimeSeconds,
    sessionId,
  ]);

  useEffect(() => {
    if (!open) return;
    void fetchJson<{
      platforms?: Array<{ accounts?: SocialAccount[] }>;
    }>("/api/social/accounts").then(({ ok, data }) => {
      if (!ok) return;
      const list = (data.platforms ?? []).flatMap((p) => p.accounts ?? []);
      const active = list.filter((a) => a.isActive !== false);
      setAccounts(active);
      const defaults = active.filter((a) => a.isDefault).map((a) => a.id);
      setSelectedAccountIds(
        defaults.length > 0 ? defaults.slice(0, 4) : active.slice(0, 2).map((a) => a.id)
      );
    });
  }, [open]);

  const previewMeta = PLATFORM_PRESETS[previewPlatform];
  const thumbUrl = clipThumbnailApiUrl(clip.id);

  const duration = clip.endTimeSeconds - clip.startTimeSeconds;
  const durationHint = useMemo(() => {
    const rec = previewMeta.recommendedDuration;
    if (!rec) return null;
    if (duration < (rec.min ?? 0))
      return `A bit short for ${previewMeta.name} — aim ${rec.min}–${rec.max}s`;
    if (rec.max && duration > rec.max)
      return `A bit long for ${previewMeta.name} — aim ≤${rec.max}s`;
    return `Nice length for ${previewMeta.name}`;
  }, [duration, previewMeta]);

  const saveLayout = useCallback(
    async (presetId: ContentLookPresetId, jobId: string | null) => {
      const selection = buildVerticalSelection(
        presetId,
        jobId,
        includeCaptions
      );
      await fetchJson(`/api/clips/${clip.id}/vertical-layout`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selection),
      });
      return selection;
    },
    [clip.id, includeCaptions]
  );

  /** Instant look change — video updates via CSS; persist in background. */
  const selectLook = useCallback(
    (presetId: ContentLookPresetId) => {
      userChoseLookRef.current = true;
      const gen = ++lookGenRef.current;
      setLookPreset(presetId);
      setAnalysisError(null);

      const preset = getContentLookPreset(presetId);
      // Keep existing face job when possible — don't re-analyze on every tap.
      const jobId = faceJobId;

      void (async () => {
        try {
          await fetchJson(`/api/clips/${clip.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              suggestedLayout: preset.layout,
              status: "saved",
            }),
          });
          if (gen !== lookGenRef.current) return;
          await saveLayout(presetId, jobId);
        } catch {
          // Soft-fail — look is already applied in the preview.
        }
      })();
    },
    [clip.id, faceJobId, saveLayout]
  );

  async function handleRenderDownload() {
    setRendering(true);
    setActionError(null);
    setActionOk(null);
    setRenderProgress(5);
    try {
      const selection = buildVerticalSelection(
        lookPreset,
        faceJobId,
        includeCaptions
      );
      const result = await renderClip(
        clip.id,
        "vertical",
        includeCaptions,
        captionAppearance,
        undefined,
        (u) => setRenderProgress(u.progress),
        undefined,
        undefined,
        selection
      );
      setDownloadUrl(result.downloadUrl);
      await triggerFileDownload(
        result.downloadUrl,
        `${clip.title.slice(0, 40) || "short"}.mp4`
      );
      setActionOk("Download started.");
      onClipChange({ ...clip, status: "rendered" });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Render failed");
    } finally {
      setRendering(false);
    }
  }

  async function ensureRendered(): Promise<boolean> {
    if (downloadUrl || clip.status === "rendered") return true;
    setRendering(true);
    setActionError(null);
    try {
      const selection = buildVerticalSelection(
        lookPreset,
        faceJobId,
        includeCaptions
      );
      const result = await renderClip(
        clip.id,
        "vertical",
        includeCaptions,
        captionAppearance,
        undefined,
        (u) => setRenderProgress(u.progress),
        undefined,
        undefined,
        selection
      );
      setDownloadUrl(result.downloadUrl);
      onClipChange({ ...clip, status: "rendered" });
      return true;
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Render failed");
      return false;
    } finally {
      setRendering(false);
    }
  }

  async function handlePlatformPack() {
    if (selectedPlatforms.length === 0) {
      setActionError("Select at least one platform.");
      return;
    }
    setPacking(true);
    setActionError(null);
    setActionOk(null);
    try {
      const ready = await ensureRendered();
      if (!ready) return;
      const res = await fetch(`/api/clips/${clip.id}/platform-exports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selected: selectedPlatforms,
          platforms: selectedPlatforms,
          includeCaptions,
          burnSubtitles: includeCaptions,
          generateCopy: true,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Platform export failed");
      setActionOk(
        "Platform exports queued. Open the export page for downloads per platform."
      );
      window.open(`/clips/${clip.id}/export`, "_blank");
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Platform export failed"
      );
    } finally {
      setPacking(false);
    }
  }

  async function handleAutoPost() {
    if (selectedAccountIds.length === 0) {
      setActionError("Connect and select at least one account to post.");
      return;
    }
    setPublishing(true);
    setActionError(null);
    setActionOk(null);
    try {
      const ready = await ensureRendered();
      if (!ready) return;

      // Ensure platform packs exist for selected destinations when possible.
      const neededExports = selectedPlatforms.filter((p) =>
        selectedAccountIds.some((id) => {
          const acc = accounts.find((a) => a.id === id);
          return acc && EXPORT_TO_SOCIAL[p] === acc.platform;
        })
      );
      if (neededExports.length > 0) {
        await fetch(`/api/clips/${clip.id}/platform-exports`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            selected: neededExports,
            platforms: neededExports,
            includeCaptions,
            burnSubtitles: includeCaptions,
            generateCopy: true,
          }),
        }).catch(() => null);
      }

      const destinations = selectedAccountIds
        .map((accountId) => {
          const account = accounts.find((a) => a.id === accountId);
          if (!account) return null;
          return {
            connectedSocialAccountId: accountId,
            platform: account.platform,
          };
        })
        .filter(Boolean);

      const res = await fetch(`/api/social/clips/${clip.id}/publish-groups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destinations }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Publish failed");
      setActionOk("Publish jobs created — tracking on the publish page.");
      window.open(`/clips/${clip.id}/publish`, "_blank");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Publish failed");
    } finally {
      setPublishing(false);
    }
  }

  function togglePlatform(key: PlatformKey) {
    setSelectedPlatforms((prev) =>
      prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key]
    );
  }

  function toggleAccount(id: string) {
    setSelectedAccountIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[2147483000] bg-black/80"
      role="dialog"
      aria-modal="true"
      aria-label="Edit clip"
      onClick={onClose}
    >
      <div
        ref={scrollRef}
        className="absolute inset-0 overflow-y-auto overscroll-contain"
        style={{ WebkitOverflowScrolling: "touch" }}
        onClick={onClose}
      >
        <div className="flex min-h-full justify-center px-3 py-4 sm:px-6 sm:py-8">
          <div
            className="relative my-auto flex w-full max-w-6xl flex-col rounded-2xl border border-[var(--color-card-border)] bg-[var(--color-background)] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="sticky top-0 z-20 flex shrink-0 items-start justify-between gap-3 border-b border-[var(--color-card-border)] bg-[var(--color-background)] px-4 py-3 sm:px-5">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8f9b89]">
                  Clip studio
                </p>
                <h2 className="truncate text-lg font-semibold">{clip.title}</h2>
                <p className="text-xs text-[var(--color-muted)]">
                  {formatSeconds(clip.startTimeSeconds)}–
                  {formatSeconds(clip.endTimeSeconds)} ·{" "}
                  {formatSeconds(duration)}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-2 text-[var(--color-muted)] hover:bg-[#141814] hover:text-white"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </header>

            <div className="sticky top-[4.5rem] z-20 flex shrink-0 gap-1 border-b border-[var(--color-card-border)] bg-[var(--color-background)] px-3 py-2">
              {(
                [
                  ["edit", "Edit"],
                  ["preview", "Platform preview"],
                  ["export", "Download / Post"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-xs font-semibold",
                    tab === id
                      ? "bg-[var(--color-accent)] text-black"
                      : "text-[var(--color-muted)] hover:bg-[#141814] hover:text-white"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="p-4 pb-10 sm:p-5 sm:pb-12">
          {tab === "edit" && (
            <div className="space-y-5">
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-[0.12em] text-[#8f9b89]">
                  Look
                </p>
                <p className="mb-3 text-xs text-[var(--color-muted)]">
                  Tap to change — the preview updates instantly.
                </p>
                <div className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {CONTENT_LOOK_PRESETS.map((preset) => {
                    const selected = lookPreset === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => selectLook(preset.id)}
                        className={cn(
                          "flex w-[14.5rem] shrink-0 items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition",
                          selected
                            ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 ring-1 ring-[var(--color-accent)]"
                            : "border-[var(--color-card-border)] hover:border-[#4a5a48]"
                        )}
                      >
                        <LookLayoutMock
                          presetId={preset.id}
                          frameUrl={thumbUrl}
                          className="h-14 w-8 shrink-0 rounded-md"
                        />
                        <span className="min-w-0">
                          <span className="flex items-center gap-1.5 text-xs font-semibold leading-snug">
                            <LookPresetGlyph
                              presetId={preset.id}
                              className="h-3.5 w-3.5 shrink-0 text-[var(--color-accent)]"
                            />
                            {preset.label}
                          </span>
                          <span className="mt-0.5 block text-[11px] leading-snug text-[var(--color-muted)]">
                            {preset.behavior}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                {analysisError && (
                  <p className="mt-2 text-xs text-[var(--color-warning,#e6b84d)]">
                    {analysisError}
                  </p>
                )}
                {analyzingFace && (
                  <p className="mt-2 flex items-center gap-2 text-xs text-[var(--color-muted)]">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-accent)]" />
                    Tracking faces… {analysisProgress}%
                  </p>
                )}
                {faceTrackingReady && !analyzingFace && !analysisError && (
                  <p className="mt-2 flex items-center gap-2 text-xs text-[var(--color-accent)]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" />
                    Face tracking ready
                  </p>
                )}
              </div>

              <AgentClipEditor
                sessionId={sessionId}
                clip={clip}
                playbackUrl={playbackUrl}
                sourceDuration={sourceDuration}
                includeCaptions={includeCaptions}
                onIncludeCaptionsChange={onIncludeCaptionsChange}
                captionAppearance={captionAppearance}
                onCaptionAppearanceChange={onCaptionAppearanceChange}
                onClipChange={onClipChange}
                lookPreset={lookPreset}
                faceRect={faceRect}
                faceKeyframes={faceKeyframes}
              />
            </div>
          )}

          {tab === "preview" && (
            <div className="mx-auto flex max-w-2xl flex-col items-center gap-5">
              <div className="w-full space-y-1.5 text-center">
                <h3 className="text-base font-semibold">Platform preview</h3>
                <p className="text-xs text-[var(--color-muted)]">
                  Same look as Edit — framed for each app. Change the look on the
                  Edit tab.
                </p>
              </div>

              <PlatformChipRow
                platforms={PREVIEW_PLATFORMS}
                value={previewPlatform}
                onChange={setPreviewPlatform}
              />

              <PlatformPhoneFrame
                platform={previewPlatform}
                lookPresetId={lookPreset}
                frameUrl={thumbUrl}
                includeCaptions={includeCaptions}
              />

              {durationHint && (
                <p className="text-center text-xs text-[var(--color-muted)]">
                  {durationHint}
                </p>
              )}

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setTab("edit")}
              >
                Back to edit
              </Button>
            </div>
          )}

          {tab === "export" && (
            <div className="mx-auto max-w-2xl space-y-6">
              <div className="rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)] p-4">
                <h3 className="text-sm font-semibold">Download</h3>
                <p className="mt-1 text-xs text-[var(--color-muted)]">
                  Render a vertical Short with your look (
                  {getContentLookPreset(lookPreset).label}
                  ){includeCaptions ? " and burned captions" : ""}.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    disabled={rendering}
                    onClick={() => void handleRenderDownload()}
                  >
                    {rendering
                      ? `Rendering… ${renderProgress}%`
                      : downloadUrl
                        ? "Download again"
                        : "Render & download"}
                  </Button>
                </div>
              </div>

              <div className="rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)] p-4">
                <h3 className="text-sm font-semibold">Platform exports</h3>
                <p className="mt-1 text-xs text-[var(--color-muted)]">
                  Generate sized packs (Shorts, TikTok, Reels, …) then download
                  each.
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {PREVIEW_PLATFORMS.map((key) => {
                    const p = PLATFORM_PRESETS[key];
                    const checked = selectedPlatforms.includes(key);
                    return (
                      <label
                        key={key}
                        className={cn(
                          "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs",
                          checked
                            ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10"
                            : "border-[var(--color-card-border)]"
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => togglePlatform(key)}
                          className="accent-[var(--color-accent)]"
                        />
                        {p.name}
                      </label>
                    );
                  })}
                </div>
                <Button
                  type="button"
                  className="mt-3"
                  variant="outline"
                  disabled={packing || rendering || selectedPlatforms.length === 0}
                  onClick={() => void handlePlatformPack()}
                >
                  {packing ? "Creating packs…" : "Create platform packs"}
                </Button>
              </div>

              <div className="rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)] p-4">
                <h3 className="text-sm font-semibold">Post automatically</h3>
                <p className="mt-1 text-xs text-[var(--color-muted)]">
                  Publish to connected accounts.{" "}
                  <a
                    href="/settings/connected-accounts"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[var(--color-accent)] hover:underline"
                  >
                    Manage connections
                  </a>
                </p>
                {accounts.length === 0 ? (
                  <p className="mt-3 text-xs text-[var(--color-muted)]">
                    No connected accounts yet. Connect YouTube, TikTok, Instagram,
                    Facebook, or X in settings, then come back.
                  </p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {accounts.map((account) => (
                      <label
                        key={account.id}
                        className="flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-xs"
                      >
                        <input
                          type="checkbox"
                          checked={selectedAccountIds.includes(account.id)}
                          onChange={() => toggleAccount(account.id)}
                          className="accent-[var(--color-accent)]"
                        />
                        <span className="font-medium capitalize">
                          {account.platform}
                        </span>
                        <span className="text-[var(--color-muted)]">
                          {account.displayName || account.username || account.id}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
                <Button
                  type="button"
                  className="mt-3"
                  disabled={
                    publishing ||
                    rendering ||
                    selectedAccountIds.length === 0
                  }
                  onClick={() => void handleAutoPost()}
                >
                  {publishing ? "Publishing…" : "Post to selected accounts"}
                </Button>
              </div>

              {actionError && (
                <p className="text-sm text-[var(--color-danger)]">{actionError}</p>
              )}
              {actionOk && (
                <p className="text-sm text-[var(--color-accent)]">{actionOk}</p>
              )}
            </div>
          )}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
