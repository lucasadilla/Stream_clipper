"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type SyntheticEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  Check,
  Copy,
  Download,
  Link2,
  LockKeyhole,
  Pause,
  Play,
  RotateCcw,
  Send,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { AgentClipEditor } from "@/components/agent/AgentClipEditor";
import {
  LookLayoutMock,
  LookPresetGlyph,
  LookVideoStage,
  PlatformChipRow,
  PlatformPhoneFrame,
} from "@/components/agent/AgentStudioPreviews";
import { PlatformCopyEditor } from "@/components/agent/PlatformCopyEditor";
import type { ClipSuggestionData } from "@/components/ClipSuggestionCard";
import type { CaptionAppearance } from "@/lib/captionAppearance";
import {
  applyCaptionEdits,
  type CaptionEditsMap,
} from "@/lib/captionEdits";
import {
  buildCaptionTrack,
  lookupCueAtTime,
  type TranscriptChunkInput,
} from "@/lib/captionTrack";
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
import type { PlatformCopy, PlatformKey } from "@/lib/platforms/types";
import {
  emptySocialContent,
  type SocialGeneratedContent,
  type SocialPlatform,
} from "@/lib/social/types";
import { renderClip } from "@/lib/clipActions";
import { triggerFileDownload } from "@/lib/clientDownload";
import { clipThumbnailApiUrl } from "@/lib/downloadUrls";
import { fetchJson } from "@/lib/apiClient";
import { formatSeconds } from "@/lib/time";
import { PlatformBrandIcon } from "@/components/brand/PlatformBrandIcon";
import type {
  ManualReframeKeyframe,
  ReframeStyle,
} from "@/lib/professionalReframe";
import type { VerticalLayout } from "@/lib/verticalLayout";
import {
  previewCameraFrameAt,
  type PreviewCropKeyframe,
} from "@/lib/reframePlayback";
import { buildFallbackPlatformCopy } from "@/lib/platformCopyDefaults";

type StudioTab = "edit" | "preview" | "export";

function mergeManualPreviewKeyframes(
  automatic: PreviewCropKeyframe[],
  manual: ManualReframeKeyframe[]
): PreviewCropKeyframe[] {
  if (manual.length === 0) return automatic;
  return [
    ...automatic.filter(
      (frame) =>
        !manual.some(
          (override) =>
            Math.abs(override.timestampSeconds - frame.timestampSeconds) < 0.2
        )
    ),
    ...manual,
  ].sort((a, b) => a.timestampSeconds - b.timestampSeconds);
}

const PREVIEW_PLATFORMS: PlatformKey[] = [
  "youtube_shorts",
  "tiktok",
  "instagram_reels",
  "instagram_feed",
  "facebook_reels",
  "x",
  "youtube_landscape",
];
const ALL_PLATFORM_KEYS = Object.keys(PLATFORM_PRESETS) as PlatformKey[];

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

function platformCopyForClip(
  platform: PlatformKey,
  clip: Pick<
    ClipSuggestionData,
    "title" | "reason" | "startTimeSeconds" | "endTimeSeconds"
  >
): PlatformCopy {
  return buildFallbackPlatformCopy({
    platform,
    clipTitle: clip.title,
    clipReason: clip.reason,
    transcriptText: "",
    durationSeconds: clip.endTimeSeconds - clip.startTimeSeconds,
  });
}

function platformCopiesForClip(
  clip: Pick<
    ClipSuggestionData,
    "title" | "reason" | "startTimeSeconds" | "endTimeSeconds"
  >
): Record<PlatformKey, PlatformCopy> {
  return Object.fromEntries(
    ALL_PLATFORM_KEYS.map((platform) => [
      platform,
      platformCopyForClip(platform, clip),
    ])
  ) as Record<PlatformKey, PlatformCopy>;
}

function socialContentFromCopy(
  platform: SocialPlatform,
  copy: PlatformCopy
): SocialGeneratedContent {
  return {
    ...emptySocialContent(platform),
    title: copy.title ?? "",
    caption: copy.caption ?? "",
    description: copy.description ?? "",
    postText: copy.postText ?? copy.caption ?? "",
    hashtags: copy.hashtags,
    tags: copy.tags,
    thumbnailText: copy.thumbnailText ?? "",
    pinnedComment: copy.pinnedComment ?? "",
  };
}

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
  captionsEnabled: boolean,
  reframeStyle: ReframeStyle = "professional",
  lockSubject = false,
  manualKeyframes: ManualReframeKeyframe[] = []
): VerticalLayoutSelection {
  const preset = getContentLookPreset(presetId);
  const base = defaultVerticalLayoutSelection();
  return {
    ...base,
    layout: preset.layout,
    faceAnalysisJobId: faceAnalysisJobId ?? undefined,
    faceSelection: { mode: "auto" },
    reframe: {
      ...base.reframe,
      style: reframeStyle,
      lockSubject,
      manualKeyframes,
    },
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
  const [reframeStyle, setReframeStyle] =
    useState<ReframeStyle>("professional");
  const [lockSubject, setLockSubject] = useState(false);
  const [faceJobId, setFaceJobId] = useState<string | null>(null);
  const [faceRect, setFaceRect] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const [faceKeyframes, setFaceKeyframes] = useState<PreviewCropKeyframe[]>([]);
  const [faceBaseCropWidth, setFaceBaseCropWidth] = useState<number | null>(null);
  const [autoResolvedLayout, setAutoResolvedLayout] =
    useState<VerticalLayout | null>(null);
  const [manualReframeKeyframes, setManualReframeKeyframes] = useState<
    ManualReframeKeyframe[]
  >([]);
  const manualReframeKeyframesRef = useRef<ManualReframeKeyframe[]>([]);
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
  const [platformCopies, setPlatformCopies] = useState<
    Record<PlatformKey, PlatformCopy>
  >(() => platformCopiesForClip(clip));
  const platformCopyDefaultsRef = useRef(platformCopiesForClip(clip));
  const touchedPlatformCopiesRef = useRef(new Set<PlatformKey>());
  const [generatingPlatformCopy, setGeneratingPlatformCopy] = useState(false);
  const platformVideoRef = useRef<HTMLVideoElement>(null);
  const [previewTime, setPreviewTime] = useState(clip.startTimeSeconds);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [platformCaptionChunks, setPlatformCaptionChunks] = useState<
    TranscriptChunkInput[]
  >([]);
  const [platformCaptionEdits, setPlatformCaptionEdits] =
    useState<CaptionEditsMap>({});
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
  const [copyingPackage, setCopyingPackage] = useState(false);
  const [downloadingPlatform, setDownloadingPlatform] =
    useState<PlatformKey | null>(null);
  const [platformDownloadUrls, setPlatformDownloadUrls] = useState<
    Partial<Record<PlatformKey, string>>
  >({});
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
    setPlatformDownloadUrls({});
    setDownloadingPlatform(null);
    setCopyingPackage(false);
    setActionError(null);
    setActionOk(null);
    const initialCopies = platformCopiesForClip(clip);
    platformCopyDefaultsRef.current = initialCopies;
    touchedPlatformCopiesRef.current.clear();
    setPlatformCopies(initialCopies);
    setPreviewTime(clip.startTimeSeconds);
    setPreviewPlaying(false);
    setLookPreset("auto");
    setReframeStyle("professional");
    setLockSubject(false);
    setFaceJobId(null);
    setFaceRect(null);
    setFaceKeyframes([]);
    setFaceBaseCropWidth(null);
    setAutoResolvedLayout(null);
    manualReframeKeyframesRef.current = [];
    setManualReframeKeyframes([]);
    setAnalyzingFace(true);
    setAnalysisProgress(0);
    setFaceTrackingReady(false);
    setAnalysisError(null);

    void (async () => {
      const loadFaceFromJob = async (
        jobId: string,
        requestedStyle: ReframeStyle = "professional",
        requestedLock = false
      ) => {
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
              centerY?: number;
              cropWidth?: number;
              cropHeight?: number;
              interpolation?: "hold" | "ease_in_out" | "linear" | "cut";
            }>;
            warnings?: string[];
            sourceWidth?: number;
            sourceHeight?: number;
            recommendation?: { layout?: VerticalLayout };
          };
          }>(
          `/api/face-analysis/${jobId}?style=${encodeURIComponent(
            requestedStyle
          )}&lockSubject=${requestedLock ? "true" : "false"}&startSeconds=${encodeURIComponent(
            clip.startTimeSeconds
          )}&endSeconds=${encodeURIComponent(clip.endTimeSeconds)}`
        );
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
        setAutoResolvedLayout(job.recommendation?.layout ?? null);
        if (job.sourceWidth && job.sourceHeight) {
          setFaceBaseCropWidth(
            Math.min(
              1,
              Math.max(0.05, (9 / 16) * (job.sourceHeight / job.sourceWidth))
            )
          );
        }
        const keyframes = (job.previewKeyframes ?? []).filter(
          (keyframe) =>
            Number.isFinite(keyframe.timestampSeconds) &&
            Number.isFinite(keyframe.centerX)
        );
        setFaceKeyframes(
          mergeManualPreviewKeyframes(
            keyframes,
            manualReframeKeyframesRef.current
          )
        );
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
          settings?: {
            reframe?: {
              style?: ReframeStyle;
              lockSubject?: boolean;
              manualKeyframes?: ManualReframeKeyframe[];
            };
          };
        } | null;
      }>(`/api/clips/${clip.id}/vertical-layout`);
      if (ok && data.configuration) {
        const savedStyle =
          data.configuration.settings?.reframe?.style ?? "professional";
        const savedLock =
          data.configuration.settings?.reframe?.lockSubject ?? false;
        const savedManual =
          data.configuration.settings?.reframe?.manualKeyframes ?? [];
        setReframeStyle(savedStyle);
        setLockSubject(savedLock);
        manualReframeKeyframesRef.current = savedManual;
        setManualReframeKeyframes(savedManual);
        if (
          !userChoseLookRef.current &&
          lookGenRef.current === initialLookGeneration
        ) {
          setLookPreset(lookPresetFromLayout(data.configuration.layout));
        }
        if (data.configuration.faceAnalysisJobId) {
          setFaceJobId(data.configuration.faceAnalysisJobId);
          const status = await loadFaceFromJob(
            data.configuration.faceAnalysisJobId,
            savedStyle,
            savedLock
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
    clip.title,
    clip.reason,
    clip.startTimeSeconds,
    clip.endTimeSeconds,
    sessionId,
  ]);

  useEffect(() => {
    if (!open || !faceJobId || !faceTrackingReady) return;
    let cancelled = false;
    void fetchJson<{
      job?: {
        status?: string;
        previewKeyframes?: PreviewCropKeyframe[];
        sourceWidth?: number;
        sourceHeight?: number;
      };
    }>(
      `/api/face-analysis/${faceJobId}?style=${encodeURIComponent(
        reframeStyle
      )}&lockSubject=${lockSubject ? "true" : "false"}&startSeconds=${encodeURIComponent(
        clip.startTimeSeconds
      )}&endSeconds=${encodeURIComponent(clip.endTimeSeconds)}`
    ).then(({ ok, data }) => {
      if (cancelled || !ok || data.job?.status !== "completed") return;
      setFaceKeyframes(
        mergeManualPreviewKeyframes(
          (data.job.previewKeyframes ?? []).filter(
            (keyframe) =>
              Number.isFinite(keyframe.timestampSeconds) &&
              Number.isFinite(keyframe.centerX)
          ),
          manualReframeKeyframes
        )
      );
      if (data.job.sourceWidth && data.job.sourceHeight) {
        setFaceBaseCropWidth(
          Math.min(
            1,
            Math.max(
              0.05,
              (9 / 16) * (data.job.sourceHeight / data.job.sourceWidth)
            )
          )
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [
    open,
    faceJobId,
    faceTrackingReady,
    reframeStyle,
    lockSubject,
    clip.startTimeSeconds,
    clip.endTimeSeconds,
    manualReframeKeyframes,
  ]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setGeneratingPlatformCopy(true);
    void fetchJson<{
      copies?: Partial<Record<PlatformKey, PlatformCopy>>;
      error?: string;
    }>(`/api/clips/${clip.id}/platform-copy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platforms: ALL_PLATFORM_KEYS }),
    }).then(({ ok, data }) => {
      if (cancelled) return;
      setGeneratingPlatformCopy(false);
      if (!ok || !data.copies) return;
      const generated = {
        ...platformCopyDefaultsRef.current,
        ...data.copies,
      } as Record<PlatformKey, PlatformCopy>;
      platformCopyDefaultsRef.current = generated;
      setPlatformCopies((current) => {
        const next = { ...current };
        for (const platform of ALL_PLATFORM_KEYS) {
          if (!touchedPlatformCopiesRef.current.has(platform)) {
            next[platform] = generated[platform];
          }
        }
        return next;
      });
    }).catch(() => {
      if (!cancelled) setGeneratingPlatformCopy(false);
    });
    return () => {
      cancelled = true;
    };
  }, [clip.id, open]);

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

  useEffect(() => {
    if (!open || tab !== "preview") return;
    let cancelled = false;
    setPlatformCaptionChunks([]);
    setPlatformCaptionEdits({});
    void (async () => {
      const [events, captions] = await Promise.all([
        fetchJson<{ transcriptChunks?: TranscriptChunkInput[] }>(
          `/api/sessions/${sessionId}/events?start=${encodeURIComponent(
            Math.max(0, clip.startTimeSeconds - 2)
          )}&end=${encodeURIComponent(clip.endTimeSeconds + 2)}`
        ),
        fetchJson<{ edits?: CaptionEditsMap }>(
          `/api/sessions/${sessionId}/captions`
        ),
      ]);
      if (cancelled) return;
      if (events.ok) {
        setPlatformCaptionChunks(events.data.transcriptChunks ?? []);
      }
      if (captions.ok) {
        setPlatformCaptionEdits(captions.data.edits ?? {});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, sessionId, tab, clip.id, clip.startTimeSeconds, clip.endTimeSeconds]);

  const previewMeta = PLATFORM_PRESETS[previewPlatform];
  const thumbUrl = clipThumbnailApiUrl(clip.id);

  const duration = clip.endTimeSeconds - clip.startTimeSeconds;
  const activePlatformCopy = platformCopies[previewPlatform];
  const activeSocialPlatform = EXPORT_TO_SOCIAL[previewPlatform] ?? null;
  const activePlatformAccounts = useMemo(
    () =>
      activeSocialPlatform
        ? accounts.filter((account) => account.platform === activeSocialPlatform)
        : [],
    [accounts, activeSocialPlatform]
  );
  const activePlatformAccount =
    activePlatformAccounts.find((account) => account.isDefault) ??
    activePlatformAccounts[0] ??
    null;
  const activeConnectHref = activeSocialPlatform
    ? `/api/social/accounts/${activeSocialPlatform}/connect?redirectAfter=${encodeURIComponent(
        `/sessions/${sessionId}`
      )}`
    : "/settings/connected-accounts";
  const previewElapsed = Math.max(
    0,
    Math.min(duration, previewTime - clip.startTimeSeconds)
  );
  const platformCameraFrame = useMemo(
    () => previewCameraFrameAt(faceKeyframes, previewElapsed),
    [faceKeyframes, previewElapsed]
  );
  const platformCameraZoom =
    faceBaseCropWidth && platformCameraFrame?.cropWidth
      ? Math.min(
          1.35,
          Math.max(1, faceBaseCropWidth / platformCameraFrame.cropWidth)
        )
      : 1;
  const platformCaptionCues = useMemo(() => {
    const track = buildCaptionTrack(platformCaptionChunks, "vertical");
    return applyCaptionEdits(track, platformCaptionEdits).filter(
      (cue) =>
        cue.endTimeSeconds > clip.startTimeSeconds &&
        cue.startTimeSeconds < clip.endTimeSeconds
    );
  }, [
    platformCaptionChunks,
    platformCaptionEdits,
    clip.startTimeSeconds,
    clip.endTimeSeconds,
  ]);
  const activePlatformCaptionCue = useMemo(
    () => lookupCueAtTime(platformCaptionCues, previewTime),
    [platformCaptionCues, previewTime]
  );
  const durationHint = useMemo(() => {
    const rec = previewMeta.recommendedDuration;
    if (!rec) return null;
    if (duration < (rec.min ?? 0))
      return `A bit short for ${previewMeta.name} — aim ${rec.min}–${rec.max}s`;
    if (rec.max && duration > rec.max)
      return `A bit long for ${previewMeta.name} — aim ≤${rec.max}s`;
    return `Nice length for ${previewMeta.name}`;
  }, [duration, previewMeta]);

  const updatePlatformCopy = (next: PlatformCopy) => {
    touchedPlatformCopiesRef.current.add(previewPlatform);
    setPlatformCopies((current) => ({
      ...current,
      [previewPlatform]: next,
    }));
  };

  const resetPlatformCopy = () => {
    touchedPlatformCopiesRef.current.delete(previewPlatform);
    setPlatformCopies((current) => ({
      ...current,
      [previewPlatform]: platformCopyDefaultsRef.current[previewPlatform],
    }));
  };

  const resetPreviewPlayback = () => {
    const video = platformVideoRef.current;
    if (video) {
      video.pause();
      try {
        video.currentTime = clip.startTimeSeconds;
      } catch {
        // Metadata may still be loading; the next play will seek correctly.
      }
    }
    setPreviewPlaying(false);
    setPreviewTime(clip.startTimeSeconds);
  };

  const togglePreviewPlayback = () => {
    const video = platformVideoRef.current;
    if (!video) return;
    if (!video.paused) {
      video.pause();
      return;
    }
    const play = () => {
      if (
        video.currentTime < clip.startTimeSeconds - 0.1 ||
        video.currentTime >= clip.endTimeSeconds - 0.05
      ) {
        video.currentTime = clip.startTimeSeconds;
      }
      void video.play().catch(() => setPreviewPlaying(false));
    };
    if (video.readyState < 1) {
      video.addEventListener("loadedmetadata", play, { once: true });
      video.load();
    } else {
      play();
    }
  };

  const onPlatformPreviewTimeUpdate = (
    event: SyntheticEvent<HTMLVideoElement>
  ) => {
    const video = event.currentTarget;
    const time = video.currentTime;
    if (time < clip.startTimeSeconds - 0.15) {
      video.currentTime = clip.startTimeSeconds;
      setPreviewTime(clip.startTimeSeconds);
      return;
    }
    if (time >= clip.endTimeSeconds) {
      video.pause();
      video.currentTime = clip.startTimeSeconds;
      setPreviewTime(clip.startTimeSeconds);
      setPreviewPlaying(false);
      return;
    }
    setPreviewTime(time);
  };

  const saveLayout = useCallback(
    async (
      presetId: ContentLookPresetId,
      jobId: string | null,
      style: ReframeStyle = reframeStyle,
      locked: boolean = lockSubject,
      manual: ManualReframeKeyframe[] = manualReframeKeyframes
    ) => {
      const selection = buildVerticalSelection(
        presetId,
        jobId,
        includeCaptions,
        style,
        locked,
        manual
      );
      await fetchJson(`/api/clips/${clip.id}/vertical-layout`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selection),
      });
      return selection;
    },
    [
      clip.id,
      includeCaptions,
      reframeStyle,
      lockSubject,
      manualReframeKeyframes,
    ]
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

  const selectReframeStyle = useCallback(
    (style: ReframeStyle) => {
      setReframeStyle(style);
      void saveLayout(lookPreset, faceJobId, style, lockSubject);
    },
    [faceJobId, lockSubject, lookPreset, saveLayout]
  );

  const toggleSubjectLock = useCallback(() => {
    const next = !lockSubject;
    setLockSubject(next);
    void saveLayout(lookPreset, faceJobId, reframeStyle, next);
  }, [faceJobId, lockSubject, lookPreset, reframeStyle, saveLayout]);

  const upsertManualCameraKeyframe = useCallback(
    (keyframe: ManualReframeKeyframe) => {
      const previousManual = manualReframeKeyframesRef.current;
      const next = [
        ...previousManual.filter(
          (item) =>
            Math.abs(item.timestampSeconds - keyframe.timestampSeconds) >= 0.2
        ),
        keyframe,
      ].sort((a, b) => a.timestampSeconds - b.timestampSeconds);
      manualReframeKeyframesRef.current = next;
      setManualReframeKeyframes(next);
      setFaceKeyframes((current) =>
        mergeManualPreviewKeyframes(
          current.filter(
            (frame) =>
              !previousManual.some(
                (manual) =>
                  Math.abs(manual.timestampSeconds - frame.timestampSeconds) <
                  0.2
              )
          ),
          next
        )
      );
      void saveLayout(lookPreset, faceJobId, reframeStyle, lockSubject, next);
    },
    [faceJobId, lockSubject, lookPreset, reframeStyle, saveLayout]
  );

  const deleteManualCameraKeyframe = useCallback(
    (relativeTime: number) => {
      const previousManual = manualReframeKeyframesRef.current;
      if (previousManual.length === 0) return;
      const closest = [...previousManual].sort(
        (a, b) =>
          Math.abs(a.timestampSeconds - relativeTime) -
          Math.abs(b.timestampSeconds - relativeTime)
      )[0]!;
      if (Math.abs(closest.timestampSeconds - relativeTime) > 0.75) return;
      const next = previousManual.filter((item) => item !== closest);
      manualReframeKeyframesRef.current = next;
      setManualReframeKeyframes(next);
      setFaceKeyframes((current) =>
        current.filter(
          (frame) =>
            Math.abs(frame.timestampSeconds - closest.timestampSeconds) >= 0.2
        )
      );
      void saveLayout(lookPreset, faceJobId, reframeStyle, lockSubject, next);
    },
    [faceJobId, lockSubject, lookPreset, reframeStyle, saveLayout]
  );

  const resetManualCameraKeyframes = useCallback(() => {
    const previousManual = manualReframeKeyframesRef.current;
    manualReframeKeyframesRef.current = [];
    setManualReframeKeyframes([]);
    setFaceKeyframes((current) =>
      current.filter(
        (frame) =>
          !previousManual.some(
            (manual) =>
              Math.abs(manual.timestampSeconds - frame.timestampSeconds) < 0.2
          )
      )
    );
    void saveLayout(lookPreset, faceJobId, reframeStyle, lockSubject, []);
  }, [faceJobId, lockSubject, lookPreset, reframeStyle, saveLayout]);

  async function handleRenderDownload() {
    setRendering(true);
    setActionError(null);
    setActionOk(null);
    setRenderProgress(5);
    try {
      const selection = buildVerticalSelection(
        lookPreset,
        faceJobId,
        includeCaptions,
        reframeStyle,
        lockSubject,
        manualReframeKeyframes
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
        includeCaptions,
        reframeStyle,
        lockSubject,
        manualReframeKeyframes
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

  function activePackageText(): string {
    const copy = platformCopies[previewPlatform];
    return [
      copy.title,
      previewPlatform === "x" ? copy.postText : copy.caption,
      copy.description,
      copy.hashtags.join(" "),
      copy.tags.length > 0 ? copy.tags.join(", ") : null,
      copy.pinnedComment ? `Pinned comment: ${copy.pinnedComment}` : null,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  async function handleCopyActivePackage() {
    try {
      await navigator.clipboard.writeText(activePackageText());
      setCopyingPackage(true);
      setActionError(null);
      window.setTimeout(() => setCopyingPackage(false), 1400);
    } catch {
      setActionError("Could not copy the post package.");
    }
  }

  async function preparePlatformDownload(platform: PlatformKey): Promise<string> {
    const existing = platformDownloadUrls[platform];
    if (existing) return existing;

    const ready = await ensureRendered();
    if (!ready) throw new Error("The clip could not be rendered.");

    const response = await fetch(`/api/clips/${clip.id}/platform-exports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        selected: [platform],
        platforms: [platform],
        includeCaptions,
        burnSubtitles: includeCaptions,
        generateCopy: true,
        copyOverrides: { [platform]: platformCopies[platform] },
      }),
    });
    const body = (await response.json()) as {
      error?: string;
      pack?: { id?: string };
    };
    if (!response.ok || !body.pack?.id) {
      throw new Error(body.error ?? "Could not prepare this platform export.");
    }

    for (let attempt = 0; attempt < 300; attempt += 1) {
      const packResponse = await fetch(
        `/api/platform-export-packs/${body.pack.id}`,
        { cache: "no-store" }
      );
      const packBody = (await packResponse.json()) as {
        error?: string;
        pack?: {
          exports?: Array<{
            platform: PlatformKey;
            status: string;
            progress: number;
            downloadUrl: string | null;
            errorMessage?: string | null;
          }>;
        };
      };
      if (!packResponse.ok) {
        throw new Error(packBody.error ?? "Could not check the platform export.");
      }
      const item = packBody.pack?.exports?.find(
        (candidate) => candidate.platform === platform
      );
      if (item) {
        setRenderProgress(item.progress);
        if (item.status === "completed" && item.downloadUrl) {
          setPlatformDownloadUrls((current) => ({
            ...current,
            [platform]: item.downloadUrl!,
          }));
          return item.downloadUrl;
        }
        if (item.status === "failed") {
          throw new Error(item.errorMessage ?? "Platform export failed.");
        }
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1200));
    }
    throw new Error("Timed out preparing the platform export.");
  }

  async function handlePlatformPreviewDownload() {
    setDownloadingPlatform(previewPlatform);
    setActionError(null);
    setActionOk(null);
    try {
      const url = await preparePlatformDownload(previewPlatform);
      await triggerFileDownload(
        url,
        `${clip.title.slice(0, 40) || "clip"}-${previewPlatform}.mp4`
      );
      setActionOk(`${PLATFORM_PRESETS[previewPlatform].name} download started.`);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Platform download failed."
      );
    } finally {
      setDownloadingPlatform(null);
    }
  }

  async function handlePlatformPreviewPost() {
    if (!activePlatformAccount || !activeSocialPlatform) return;
    setPublishing(true);
    setActionError(null);
    setActionOk(null);
    try {
      await preparePlatformDownload(previewPlatform);
      const settings = {
        ...(activeSocialPlatform === "youtube"
          ? {
              youtubeFormat:
                previewPlatform === "youtube_landscape"
                  ? ("standard" as const)
                  : ("shorts" as const),
            }
          : {}),
        ...(activeSocialPlatform === "facebook"
          ? { facebookFormat: "reel" as const }
          : {}),
        ...(activeSocialPlatform === "instagram"
          ? {
              instagramFormat:
                previewPlatform === "instagram_feed"
                  ? ("feed" as const)
                  : ("reel" as const),
            }
          : {}),
      };
      const response = await fetch(
        `/api/social/clips/${clip.id}/publish-groups`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            destinations: [
              {
                connectedSocialAccountId: activePlatformAccount.id,
                platform: activeSocialPlatform,
                settings,
                content: socialContentFromCopy(
                  activeSocialPlatform,
                  platformCopies[previewPlatform]
                ),
              },
            ],
          }),
        }
      );
      const body = (await response.json()) as {
        error?: string;
        group?: { id?: string };
      };
      if (!response.ok) throw new Error(body.error ?? "Publish failed.");
      if (!body.group?.id) throw new Error("Publish draft was not created.");

      const publishResponse = await fetch(
        `/api/social/publish-groups/${body.group.id}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "publish" }),
        }
      );
      const publishBody = (await publishResponse.json()) as { error?: string };
      if (!publishResponse.ok) {
        throw new Error(publishBody.error ?? "Could not queue the post.");
      }
      setActionOk(
        `${PLATFORM_PRESETS[previewPlatform].name} post queued for ${
          activePlatformAccount.displayName ||
          activePlatformAccount.username ||
          "your connected account"
        }.`
      );
      window.open(`/clips/${clip.id}/publish`, "_blank");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Publish failed.");
    } finally {
      setPublishing(false);
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
          copyOverrides: platformCopies,
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
            copyOverrides: platformCopies,
          }),
        }).catch(() => null);
      }

      const destinations = selectedAccountIds
        .map((accountId) => {
          const account = accounts.find((a) => a.id === accountId);
          if (!account) return null;
          const platformKey =
            selectedPlatforms.find(
              (candidate) => EXPORT_TO_SOCIAL[candidate] === account.platform
            ) ??
            PREVIEW_PLATFORMS.find(
              (candidate) => EXPORT_TO_SOCIAL[candidate] === account.platform
            );
          const copy = platformKey ? platformCopies[platformKey] : null;
          return {
            connectedSocialAccountId: accountId,
            platform: account.platform,
            settings: {
              ...(account.platform === "youtube"
                ? {
                    youtubeFormat:
                      platformKey === "youtube_landscape"
                        ? ("standard" as const)
                        : ("shorts" as const),
                  }
                : {}),
              ...(account.platform === "facebook"
                ? {
                    facebookFormat:
                      platformKey === "facebook_feed"
                        ? ("page_video" as const)
                        : ("reel" as const),
                  }
                : {}),
            },
            content: copy
              ? socialContentFromCopy(account.platform, copy)
              : undefined,
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
      className="editor-shell fixed inset-0 z-[2147483000] bg-black/80 text-[var(--color-foreground)]"
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
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-muted)]">
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
                className="rounded-lg p-2 text-[var(--color-muted)] transition-colors hover:bg-[var(--color-secondary)] hover:text-[var(--color-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
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
                      ? "bg-[var(--color-accent)] text-[var(--color-accent-foreground)]"
                      : "text-[var(--color-muted)] hover:bg-[var(--color-secondary)] hover:text-[var(--color-foreground)]"
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
                <p className="mb-1 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-muted)]">
                  Look
                </p>
                <p className="mb-3 text-xs text-[var(--color-muted)]">
                  Tap to change — the preview updates instantly.
                </p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {CONTENT_LOOK_PRESETS.map((preset) => {
                    const selected = lookPreset === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => selectLook(preset.id)}
                        className={cn(
                          "flex min-w-0 items-center gap-2.5 rounded-xl border bg-[var(--color-card)] px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
                          selected
                            ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 ring-1 ring-[var(--color-accent)]"
                            : "border-[var(--color-card-border)] hover:border-[var(--color-accent)]/60 hover:bg-[var(--color-secondary)]"
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
                {(lookPreset === "just_chatting" || lookPreset === "auto") && (
                  <div className="mt-3 flex flex-col gap-2 rounded-lg border border-[var(--color-card-border)] bg-[var(--color-secondary)]/45 p-2.5 sm:flex-row sm:items-center sm:justify-between">
                    <div
                      className="grid min-w-0 grid-cols-5 gap-1"
                      role="group"
                      aria-label="Auto framing style"
                    >
                      {(
                        [
                          ["professional", "Pro"],
                          ["dynamic", "Dynamic"],
                          ["stable", "Stable"],
                          ["close", "Close"],
                          ["context", "Context"],
                        ] as const
                      ).map(([id, label]) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => selectReframeStyle(id)}
                          className={cn(
                            "min-w-0 rounded-md px-2 py-1.5 text-[10px] font-semibold transition-colors sm:text-[11px]",
                            reframeStyle === id
                              ? "bg-[var(--color-foreground)] text-[var(--color-background)]"
                              : "text-[var(--color-muted)] hover:bg-[var(--color-card)] hover:text-[var(--color-foreground)]"
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={toggleSubjectLock}
                      className={cn(
                        "flex shrink-0 items-center justify-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-semibold transition-colors",
                        lockSubject
                          ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]"
                          : "border-[var(--color-card-border)] text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
                      )}
                    >
                      <LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" />
                      {lockSubject ? "Person locked" : "Lock person"}
                    </button>
                  </div>
                )}
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
                faceBaseCropWidth={faceBaseCropWidth}
                autoResolvedLayout={autoResolvedLayout}
                manualCameraKeyframeCount={manualReframeKeyframes.length}
                onAddCameraKeyframe={upsertManualCameraKeyframe}
                onDeleteCameraKeyframe={deleteManualCameraKeyframe}
                onResetCameraKeyframes={resetManualCameraKeyframes}
              />
            </div>
          )}

          {tab === "preview" && (
            <div className="mx-auto flex max-w-6xl flex-col items-center gap-5">
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
                onChange={(platform) => {
                  resetPreviewPlayback();
                  setPreviewPlatform(platform);
                  setCopyingPackage(false);
                  setActionError(null);
                  setActionOk(null);
                }}
              />

              <div className="grid w-full items-start gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(19rem,0.75fr)]">
                <div className="min-w-0 space-y-3">
                  <PlatformPhoneFrame
                    platform={previewPlatform}
                    lookPresetId={lookPreset}
                    frameUrl={thumbUrl}
                    includeCaptions={includeCaptions}
                    captionCue={activePlatformCaptionCue}
                    captionTime={previewTime}
                    captionAppearance={captionAppearance}
                    copy={activePlatformCopy}
                  >
                    {playbackUrl ? (
                      <LookVideoStage
                        presetId={lookPreset}
                        playbackUrl={playbackUrl}
                        videoRef={platformVideoRef}
                        faceRect={faceRect}
                        faceCenterX={platformCameraFrame?.centerX}
                        faceCenterY={platformCameraFrame?.centerY}
                        zoom={platformCameraZoom}
                        layoutOverride={
                          lookPreset === "auto" ? autoResolvedLayout : null
                        }
                        className="h-full w-full rounded-none border-0"
                        onTimeUpdate={onPlatformPreviewTimeUpdate}
                        onPlay={() => setPreviewPlaying(true)}
                        onPause={() => setPreviewPlaying(false)}
                      />
                    ) : undefined}
                  </PlatformPhoneFrame>

                  <div className="mx-auto w-full max-w-2xl rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)] p-3">
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={togglePreviewPlayback}
                        disabled={!playbackUrl}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent)] text-[var(--color-accent-foreground)] transition hover:bg-[var(--color-accent-hover)] disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label={previewPlaying ? "Pause platform preview" : "Play platform preview"}
                      >
                        {previewPlaying ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
                      </button>
                      <input
                        type="range"
                        min={0}
                        max={Math.max(0.1, duration)}
                        step={0.05}
                        value={previewElapsed}
                        disabled={!playbackUrl}
                        onChange={(event) => {
                          const next = clip.startTimeSeconds + Number(event.target.value);
                          setPreviewTime(next);
                          if (platformVideoRef.current) {
                            platformVideoRef.current.currentTime = next;
                          }
                        }}
                        className="h-1.5 min-w-0 flex-1 cursor-pointer accent-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label="Platform preview playback position"
                      />
                      <span className="shrink-0 font-mono text-[10px] text-[var(--color-muted)]">
                        {formatSeconds(previewElapsed)} / {formatSeconds(duration)}
                      </span>
                      <button
                        type="button"
                        onClick={resetPreviewPlayback}
                        disabled={!playbackUrl}
                        className="rounded-lg p-2 text-[var(--color-muted)] hover:bg-[var(--color-secondary)] hover:text-[var(--color-foreground)] disabled:opacity-40"
                        aria-label="Restart platform preview"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-[var(--color-muted)]">
                      <span>{playbackUrl ? "Watch the selected clip inside the final post frame." : "Preview video is not available yet."}</span>
                      {durationHint && <span className="font-medium text-[var(--color-accent)]">{durationHint}</span>}
                    </div>
                  </div>
                </div>

                <PlatformCopyEditor
                  key={previewPlatform}
                  platform={previewPlatform}
                  copy={activePlatformCopy}
                  generating={generatingPlatformCopy}
                  onChange={updatePlatformCopy}
                  onReset={resetPlatformCopy}
                />
              </div>

              <div className="flex w-full flex-col gap-4 border-y border-[var(--color-card-border)] bg-[#050805] px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <PlatformBrandIcon brand={previewPlatform} size="sm" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[var(--color-foreground)]">
                      {previewMeta.name}
                    </p>
                    <p className="truncate text-[11px] text-[var(--color-muted)]">
                      {activePlatformAccount
                        ? `Connected to ${
                            activePlatformAccount.displayName ||
                            activePlatformAccount.username ||
                            "your account"
                          }`
                        : `${previewMeta.name} is not connected`}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleCopyActivePackage()}
                    className="inline-flex h-10 items-center gap-2 border border-[var(--color-card-border)] px-3 text-xs font-semibold text-[var(--color-foreground)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
                  >
                    {copyingPackage ? (
                      <Check className="h-4 w-4 text-[var(--color-accent)]" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                    {copyingPackage ? "Copied" : "Copy package"}
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(downloadingPlatform) || rendering || publishing}
                    onClick={() => void handlePlatformPreviewDownload()}
                    className="inline-flex h-10 items-center gap-2 border border-[var(--color-card-border)] px-3 text-xs font-semibold text-[var(--color-foreground)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <Download className="h-4 w-4" />
                    {downloadingPlatform === previewPlatform ||
                    (rendering && !publishing)
                      ? `Preparing ${renderProgress}%`
                      : platformDownloadUrls[previewPlatform]
                        ? "Download again"
                        : "Download video"}
                  </button>
                  {activePlatformAccount ? (
                    <button
                      type="button"
                      disabled={publishing || Boolean(downloadingPlatform) || rendering}
                      onClick={() => void handlePlatformPreviewPost()}
                      className="inline-flex h-10 items-center gap-2 bg-[var(--color-accent)] px-4 text-xs font-semibold text-black transition-colors hover:bg-[var(--color-accent-hover)] disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <Send className="h-4 w-4" />
                      {publishing ? "Preparing post..." : "Post"}
                    </button>
                  ) : (
                    <a
                      href={activeConnectHref}
                      className="inline-flex h-10 items-center gap-2 bg-[var(--color-accent)] px-4 text-xs font-semibold text-black transition-colors hover:bg-[var(--color-accent-hover)]"
                    >
                      <Link2 className="h-4 w-4" />
                      Connect
                    </a>
                  )}
                </div>
              </div>

              {(actionError || actionOk) && (
                <div className="w-full text-center text-xs">
                  {actionError && (
                    <p className="text-[var(--color-danger)]">{actionError}</p>
                  )}
                  {actionOk && (
                    <p className="text-[var(--color-accent)]">{actionOk}</p>
                  )}
                </div>
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
