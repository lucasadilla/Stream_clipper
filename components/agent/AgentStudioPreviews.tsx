"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
  type SyntheticEvent,
} from "react";
import {
  ArrowLeft,
  Bell,
  Bookmark,
  ChevronDown,
  Heart,
  Home,
  Menu,
  MessageCircle,
  MoreHorizontal,
  Music2,
  Plus,
  Repeat2,
  Search,
  Send,
  Share2,
  ThumbsDown,
  ThumbsUp,
  User,
  Gamepad2,
  MessagesSquare,
  MonitorPlay,
  ScanFace,
  WandSparkles,
} from "lucide-react";
import { cn } from "@/lib/cn";
import type { ContentLookPresetId } from "@/lib/contentLookPresets";
import { getContentLookPreset } from "@/lib/contentLookPresets";
import {
  captionAnimationClass,
  captionPreviewStyle,
  type CaptionAppearance,
} from "@/lib/captionAppearance";
import type { CaptionCue } from "@/lib/captionTrack";
import type { PlatformCopy, PlatformKey } from "@/lib/platforms/types";
import { PLATFORM_PRESETS } from "@/lib/platforms/presets";
import {
  PLATFORM_SAFE_ZONES,
  type PlatformSafeZone,
} from "@/lib/platforms/safeZones";
import { CaptionCueText } from "@/components/CaptionCueText";
import { PlatformBrandIcon } from "@/components/brand/PlatformBrandIcon";
import type { VerticalLayout } from "@/lib/verticalLayout";

export function LookPresetGlyph({
  presetId,
  className,
}: {
  presetId: ContentLookPresetId;
  className?: string;
}) {
  const Icon =
    presetId === "gaming"
      ? Gamepad2
      : presetId === "just_chatting"
        ? ScanFace
        : presetId === "podcast"
          ? MessagesSquare
          : presetId === "gameplay_only"
            ? MonitorPlay
            : WandSparkles;
  return <Icon className={className} aria-hidden="true" />;
}

/** Instant CSS mock of a look preset (thumbnail / chip preview). */
export function LookLayoutMock({
  presetId,
  frameUrl,
  className,
  label,
}: {
  presetId: ContentLookPresetId;
  frameUrl: string | null;
  className?: string;
  label?: string;
}) {
  const preset = getContentLookPreset(presetId);
  const layout = preset.layout;

  const cover = (zoom = "cover", pos = "center"): CSSProperties =>
    frameUrl
      ? {
          backgroundImage: `url(${frameUrl})`,
          backgroundSize: zoom,
          backgroundPosition: pos,
        }
      : { background: "#0a0c0a" };

  const face: CSSProperties = frameUrl
    ? {
        backgroundImage: `url(${frameUrl})`,
        backgroundSize: "180% 180%",
        backgroundPosition: "15% 20%",
      }
    : { background: "#1a2418" };

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-[var(--color-card-border)] bg-black",
        className
      )}
      style={{ aspectRatio: "9 / 16" }}
      aria-label={`${preset.label} look preview`}
    >
      {layout === "facecam_top_gameplay_bottom" && (
        <div className="absolute inset-0 flex flex-col">
          <div className="relative h-[38%]" style={face} />
          <div
            className="relative flex-1 border-t border-white/15"
            style={cover()}
          />
        </div>
      )}

      {layout === "facecam_bottom_gameplay_top" && (
        <div className="absolute inset-0 flex flex-col">
          <div className="relative flex-1" style={cover()} />
          <div
            className="relative h-[38%] border-t border-white/15"
            style={face}
          />
        </div>
      )}

      {layout === "facecam_pip" && (
        <div className="absolute inset-0" style={cover("cover", "center")}>
          <div
            className="absolute right-[4%] top-[8%] w-[34%] overflow-hidden rounded-md border-2 border-white/90 shadow-lg"
            style={{ aspectRatio: "1 / 1", ...face }}
          />
        </div>
      )}

      {layout === "subject_aware_crop" && (
        <div className="absolute inset-0">
          <div
            className="absolute inset-0 scale-110 opacity-40 blur-[2px]"
            style={cover("cover", "center")}
          />
          <div
            className="absolute inset-y-0 left-1/2 w-[58%] -translate-x-1/2 shadow-[0_0_0_999px_rgba(0,0,0,0.55)]"
            style={cover("cover", "35% 20%")}
          />
          <div className="absolute left-1/2 top-[22%] flex h-[30%] w-[48%] -translate-x-1/2 items-center justify-center rounded border border-[var(--color-accent)]/80 bg-black/10">
            <ScanFace className="h-4 w-4 text-[var(--color-accent)]" />
          </div>
        </div>
      )}

      {layout === "gameplay_full" && (
        <div className="absolute inset-0" style={cover("135% 135%", "center")} />
      )}

      {(layout === "center_crop" || layout === "auto") && (
        <div className="absolute inset-0" style={cover("cover", "center")}>
          {layout === "auto" && (
            <WandSparkles className="absolute right-1.5 top-1.5 h-3.5 w-3.5 text-[var(--color-accent)]" />
          )}
        </div>
      )}

      {label && (
        <span className="absolute left-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-white">
          {label}
        </span>
      )}
    </div>
  );
}

/**
 * Single live video stage — look changes are CSS-only and instant.
 * Primary <video> stays mounted so scrubbing/playhead survive look switches.
 * Captions (children) sit on top of the composed frame.
 */
export function LookVideoStage({
  presetId,
  playbackUrl,
  videoRef,
  className,
  children,
  onTimeUpdate,
  onPlay,
  onPause,
  faceRect,
  faceCenterX,
  faceCenterY,
  zoom = 1,
  layoutOverride,
}: {
  presetId: ContentLookPresetId;
  playbackUrl: string | null;
  videoRef: RefObject<HTMLVideoElement | null>;
  className?: string;
  children?: ReactNode;
  onTimeUpdate?: (event: SyntheticEvent<HTMLVideoElement>) => void;
  onPlay?: (event: SyntheticEvent<HTMLVideoElement>) => void;
  onPause?: (event: SyntheticEvent<HTMLVideoElement>) => void;
  /** Normalized face box (0..1) — keeps the face centered in look crops. */
  faceRect?: { x: number; y: number; width: number; height: number } | null;
  /** Current tracked horizontal focus, normalized to 0..1. */
  faceCenterX?: number | null;
  /** Current planned vertical focus, normalized to 0..1. */
  faceCenterY?: number | null;
  /** Stable virtual-camera zoom from the shared reframe plan. */
  zoom?: number;
  /** Resolved server recommendation while the visible preset remains Auto. */
  layoutOverride?: VerticalLayout | null;
}) {
  const layout = layoutOverride ?? getContentLookPreset(presetId).layout;
  const mirrorRef = useRef<HTMLVideoElement>(null);
  const needsMirror =
    layout === "facecam_top_gameplay_bottom" ||
    layout === "facecam_bottom_gameplay_top" ||
    layout === "facecam_pip";

  const facePos = faceObjectPosition(faceRect, faceCenterX, faceCenterY);
  const safeZoom = Math.min(1.35, Math.max(1, zoom));

  useEffect(() => {
    const main = videoRef.current;
    const mirror = mirrorRef.current;
    if (!main || !playbackUrl) return;
    if (main.getAttribute("src") !== playbackUrl) {
      main.setAttribute("src", playbackUrl);
      main.load();
    }
    if (mirror && needsMirror && mirror.getAttribute("src") !== playbackUrl) {
      mirror.setAttribute("src", playbackUrl);
      mirror.load();
    }
  }, [playbackUrl, videoRef, needsMirror]);

  useEffect(() => {
    const main = videoRef.current;
    const mirror = mirrorRef.current;
    if (!main || !mirror || !needsMirror) return;

    const sync = () => {
      if (Math.abs(mirror.currentTime - main.currentTime) > 0.12) {
        try {
          mirror.currentTime = main.currentTime;
        } catch {
          // ignore seek race
        }
      }
    };
    const onPlay = () => {
      void mirror.play().catch(() => {});
    };
    const onPause = () => mirror.pause();
    const onSeeked = () => {
      try {
        mirror.currentTime = main.currentTime;
      } catch {
        // ignore
      }
    };

    main.addEventListener("timeupdate", sync);
    main.addEventListener("play", onPlay);
    main.addEventListener("pause", onPause);
    main.addEventListener("seeked", onSeeked);
    sync();
    return () => {
      main.removeEventListener("timeupdate", sync);
      main.removeEventListener("play", onPlay);
      main.removeEventListener("pause", onPause);
      main.removeEventListener("seeked", onSeeked);
    };
  }, [videoRef, needsMirror, playbackUrl]);

  const primarySlot =
    layout === "facecam_top_gameplay_bottom"
      ? "inset-x-0 bottom-0 top-[38%]"
      : layout === "facecam_bottom_gameplay_top"
        ? "inset-x-0 bottom-[38%] top-0"
        : "inset-0";

  const primaryVideoClass =
    layout === "gameplay_full"
      ? "h-full w-full scale-[1.35] object-cover"
      : "h-full w-full object-cover";

  const mirrorSlot =
    layout === "facecam_top_gameplay_bottom"
      ? "inset-x-0 top-0 h-[38%]"
      : layout === "facecam_bottom_gameplay_top"
        ? "inset-x-0 bottom-0 h-[38%]"
        : layout === "facecam_pip"
          ? "right-[4%] top-[8%] w-[34%] rounded-md border-2 border-white/90 shadow-lg"
          : layout === "subject_aware_crop"
            ? "inset-0"
            : "hidden";

  const mirrorVideoClass =
    "h-full w-full scale-[1.85] object-cover transition-[object-position] duration-500 ease-out motion-reduce:transition-none";

  return (
    <div
      className={cn("relative overflow-hidden bg-black", className)}
      style={{ aspectRatio: "9 / 16" }}
    >
      {!playbackUrl && (
        <div className="flex h-full items-center justify-center text-sm text-[var(--color-muted)]">
          Waiting for local preview…
        </div>
      )}

      <div
        className={cn(
          "pointer-events-none absolute overflow-hidden transition-all duration-150",
          needsMirror ? mirrorSlot : "hidden"
        )}
        style={
          layout === "facecam_pip" ? { aspectRatio: "1 / 1" } : undefined
        }
      >
        <video
          ref={mirrorRef}
          className={mirrorVideoClass}
          style={{ objectPosition: facePos }}
          muted
          playsInline
          preload="auto"
        />
      </div>

      <div
        className={cn(
          "absolute overflow-hidden transition-all duration-150",
          primarySlot,
          layout === "facecam_top_gameplay_bottom" ||
            layout === "facecam_bottom_gameplay_top"
            ? "border-white/15"
            : "",
          layout === "facecam_top_gameplay_bottom" ? "border-t" : "",
          layout === "facecam_bottom_gameplay_top" ? "border-b" : "",
          "z-[1]"
        )}
      >
        {playbackUrl ? (
          <video
            ref={videoRef}
            className={cn(
              primaryVideoClass,
              "transition-[object-position,transform] duration-500 ease-out motion-reduce:transition-none"
            )}
            style={{
              objectPosition:
                layout === "subject_aware_crop" ||
                layout === "center_crop" ||
                layout === "auto" ||
                layout === "gameplay_full"
                  ? facePos
                  : "center",
              transform:
                layout === "subject_aware_crop"
                  ? `scale(${safeZoom.toFixed(4)})`
                  : undefined,
              transformOrigin:
                layout === "subject_aware_crop" ? facePos : undefined,
            }}
            playsInline
            controls
            onTimeUpdate={onTimeUpdate}
            onPlay={onPlay}
            onPause={onPause}
          />
        ) : null}
      </div>

      <div className="pointer-events-none absolute inset-0 z-10">{children}</div>
    </div>
  );
}

function faceObjectPosition(
  faceRect?: { x: number; y: number; width: number; height: number } | null,
  trackedCenterX?: number | null,
  trackedCenterY?: number | null
): string {
  const trackedX =
    typeof trackedCenterX === "number" && Number.isFinite(trackedCenterX)
      ? Math.min(1, Math.max(0, trackedCenterX))
      : null;
  const trackedY =
    typeof trackedCenterY === "number" && Number.isFinite(trackedCenterY)
      ? Math.min(1, Math.max(0, trackedCenterY))
      : null;
  if (
    !faceRect ||
    !Number.isFinite(faceRect.x) ||
    !Number.isFinite(faceRect.y) ||
    faceRect.width <= 0 ||
    faceRect.height <= 0
  ) {
    return `${((trackedX ?? 0.5) * 100).toFixed(1)}% ${((trackedY ?? 0.42) * 100).toFixed(1)}%`;
  }
  const cx =
    trackedX ??
    Math.min(1, Math.max(0, faceRect.x + faceRect.width / 2));
  const cy =
    trackedY ??
    Math.min(1, Math.max(0, faceRect.y + faceRect.height / 2));
  return `${(cx * 100).toFixed(1)}% ${(cy * 100).toFixed(1)}%`;
}

interface PlatformPreviewDetails {
  title: string;
  caption: string;
  postText: string;
  description: string;
  hashtags: string[];
  pinnedComment: string;
  captionCue: CaptionCue | null;
  captionTime: number;
  captionAppearance: CaptionAppearance;
}

function PreviewAvatar({
  size = "md",
  ring = false,
}: {
  size?: "sm" | "md" | "lg";
  ring?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#95ff00] via-[#45c91c] to-[#1378ff] font-black text-black shadow-sm",
        size === "sm" ? "h-6 w-6 text-[9px]" : size === "lg" ? "h-10 w-10 text-xs" : "h-8 w-8 text-[10px]",
        ring && "ring-2 ring-white ring-offset-2 ring-offset-black"
      )}
    >
      C
    </span>
  );
}

function PreviewMedia({
  children,
  lookPresetId,
  frameUrl,
  includeCaptions,
  className,
  captionCue,
  captionTime,
  captionAppearance,
  captionSafeZone,
  gradient = false,
}: {
  children?: ReactNode;
  lookPresetId: ContentLookPresetId;
  frameUrl: string | null;
  includeCaptions: boolean;
  className?: string;
  captionCue: CaptionCue | null;
  captionTime: number;
  captionAppearance: CaptionAppearance;
  captionSafeZone: PlatformSafeZone;
  gradient?: boolean;
}) {
  const mediaRef = useRef<HTMLDivElement>(null);
  const [mediaHeight, setMediaHeight] = useState(400);

  useEffect(() => {
    const node = mediaRef.current;
    if (!node) return;
    const updateHeight = () => {
      const nextHeight = node.getBoundingClientRect().height;
      if (nextHeight > 0) setMediaHeight(nextHeight);
    };
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const captionStyles = useMemo(() => {
    const platformAppearance =
      captionAppearance.vertical === "bottom"
        ? {
            ...captionAppearance,
            verticalOffsetPercent: Math.max(
              captionAppearance.verticalOffsetPercent,
              captionSafeZone.subtitleBottomPercent
            ),
          }
        : captionAppearance;
    const styles = captionPreviewStyle(platformAppearance, mediaHeight);
    return {
      ...styles,
      container: {
        ...styles.container,
        paddingLeft: `${Math.max(5, captionSafeZone.leftPercent)}%`,
        paddingRight: `${Math.max(5, captionSafeZone.rightPercent)}%`,
      },
    };
  }, [captionAppearance, captionSafeZone, mediaHeight]);
  return (
    <div
      ref={mediaRef}
      className={cn("relative overflow-hidden bg-[#101010]", className)}
    >
      <div className="absolute inset-0">
        {children ?? (
          <LookLayoutMock
            presetId={lookPresetId}
            frameUrl={frameUrl}
            className="h-full w-full rounded-none border-0"
          />
        )}
      </div>
      {gradient && (
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/75" />
      )}
      {includeCaptions && captionCue && captionCue.text ? (
        <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
          <div style={captionStyles.container}>
            <p
              key={captionCue.id}
              style={captionStyles.text}
              className={`whitespace-pre-line break-words ${captionAnimationClass(
                captionAppearance.animation
              )}`}
            >
              <CaptionCueText
                cue={captionCue}
                currentTime={captionTime}
                appearance={captionAppearance}
              />
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RailAction({
  icon,
  label,
}: {
  icon: ReactNode;
  label: string;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5 text-white drop-shadow-md">
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/20 backdrop-blur-[2px]">
        {icon}
      </span>
      <span className="text-[9px] font-semibold">{label}</span>
    </div>
  );
}

function VerticalPlatformPreview({
  platform,
  title,
  caption,
  hashtags,
  children,
  lookPresetId,
  frameUrl,
  includeCaptions,
  captionCue,
  captionTime,
  captionAppearance,
}: {
  platform: "youtube_shorts" | "tiktok" | "instagram_reels" | "facebook_reels";
} & PlatformPreviewDetails & {
  children?: ReactNode;
  lookPresetId: ContentLookPresetId;
  frameUrl: string | null;
  includeCaptions: boolean;
}) {
  const isTikTok = platform === "tiktok";
  const isInstagram = platform === "instagram_reels";
  const isYouTube = platform === "youtube_shorts";
  const safe = PLATFORM_SAFE_ZONES[platform];
  return (
    <div className="relative aspect-[9/16] w-[min(100%,330px)] overflow-hidden rounded-[2rem] border-[7px] border-[#191919] bg-black shadow-[0_28px_80px_rgba(0,0,0,0.62)] ring-1 ring-white/10">
      <PreviewMedia
        lookPresetId={lookPresetId}
        frameUrl={frameUrl}
        includeCaptions={includeCaptions}
        captionCue={captionCue}
        captionTime={captionTime}
        captionAppearance={captionAppearance}
        captionSafeZone={safe}
        gradient
        className="absolute inset-0"
      >
        {children}
      </PreviewMedia>

      <div className="pointer-events-none absolute left-1/2 top-2 z-30 h-5 w-24 -translate-x-1/2 rounded-full bg-black/85" />

      <div className="absolute inset-x-0 top-0 z-20 flex h-16 items-center justify-between px-4 pt-4 text-white">
        {isTikTok ? (
          <>
            <span className="w-7" />
            <div className="flex items-center gap-3 text-xs font-semibold drop-shadow">
              <span className="text-white/70">Following</span>
              <span className="relative text-white after:absolute after:-bottom-1.5 after:left-1/2 after:h-0.5 after:w-5 after:-translate-x-1/2 after:bg-white">For You</span>
            </div>
            <Search className="h-5 w-5" />
          </>
        ) : isInstagram ? (
          <>
            <span className="flex items-center gap-1 text-base font-bold">Reels <ChevronDown className="h-4 w-4" /></span>
            <span className="flex h-7 w-7 items-center justify-center rounded-lg border-2 border-white"><Plus className="h-4 w-4" /></span>
          </>
        ) : isYouTube ? (
          <>
            <ArrowLeft className="h-5 w-5" />
            <div className="flex items-center gap-4"><Search className="h-5 w-5" /><MoreHorizontal className="h-5 w-5" /></div>
          </>
        ) : (
          <>
            <span className="text-base font-bold">Reels</span>
            <div className="flex items-center gap-4"><Search className="h-5 w-5" /><PreviewAvatar size="sm" /></div>
          </>
        )}
      </div>

      <div className="absolute bottom-[19%] right-2.5 z-20 flex flex-col items-center gap-2.5">
        <div className="relative mb-1"><PreviewAvatar size="md" ring /><span className="absolute -bottom-1 left-1/2 flex h-3.5 w-3.5 -translate-x-1/2 items-center justify-center rounded-full bg-[#ff2d55] text-[10px] font-bold text-white">+</span></div>
        <RailAction icon={isYouTube ? <ThumbsUp className="h-5 w-5" /> : <Heart className="h-5 w-5" />} label="12.4K" />
        {isYouTube && <RailAction icon={<ThumbsDown className="h-5 w-5" />} label="Dislike" />}
        <RailAction icon={<MessageCircle className="h-5 w-5" />} label="328" />
        {!isYouTube && <RailAction icon={<Bookmark className="h-5 w-5" />} label="1,208" />}
        <RailAction icon={isInstagram ? <Send className="h-5 w-5" /> : <Share2 className="h-5 w-5" />} label="Share" />
        {isTikTok && <span className="mt-1 flex h-9 w-9 items-center justify-center rounded-full bg-[#171717] ring-4 ring-[#252525]"><Music2 className="h-4 w-4 text-white" /></span>}
      </div>

      <div className="absolute inset-x-0 bottom-[7%] z-20 px-3 pr-14 text-white drop-shadow-md">
        <div className="mb-1 flex items-center gap-2 text-[11px] font-bold">
          <span>@clipper</span>
          {!isYouTube && <span className="rounded border border-white/80 px-1.5 py-0.5 text-[9px]">Follow</span>}
          {isYouTube && <span className="rounded-full bg-white px-2 py-1 text-[9px] text-black">Subscribe</span>}
        </div>
        <p className="line-clamp-2 text-[10px] font-medium leading-relaxed">{isYouTube ? title : caption}</p>
        <p className="mt-0.5 truncate text-[10px] font-semibold">{hashtags.join(" ")}</p>
        {!isYouTube && (
          <p className="mt-1 flex items-center gap-1 truncate text-[9px]"><Music2 className="h-3 w-3" /> Original audio · Clipper</p>
        )}
      </div>

      <div className="absolute inset-x-0 bottom-0 z-20 h-[7%] bg-black/95 px-4 text-white">
        <div className="flex h-full items-center justify-around">
          <Home className="h-4 w-4" />
          {isTikTok ? <Search className="h-4 w-4" /> : isYouTube ? <span className="text-[9px] font-bold">Shorts</span> : <MessageCircle className="h-4 w-4" />}
          <span className={cn("flex h-5 w-8 items-center justify-center rounded-md", isTikTok ? "bg-white text-black shadow-[-3px_0_0_#25f4ee,3px_0_0_#fe2c55]" : "border border-white")}><Plus className="h-3.5 w-3.5" /></span>
          <User className="h-4 w-4" />
        </div>
      </div>
    </div>
  );
}

function InstagramFeedPreview({
  title,
  caption,
  hashtags,
  children,
  lookPresetId,
  frameUrl,
  includeCaptions,
  captionCue,
  captionTime,
  captionAppearance,
}: Omit<Parameters<typeof VerticalPlatformPreview>[0], "platform">) {
  return (
    <div className="w-[min(100%,410px)] overflow-hidden rounded-[1.7rem] border-[6px] border-[#191919] bg-black text-white shadow-[0_28px_80px_rgba(0,0,0,0.58)] ring-1 ring-white/10">
      <div className="flex h-12 items-center justify-between border-b border-white/10 px-3">
        <div className="flex items-center gap-2"><PreviewAvatar /><div><p className="text-[11px] font-bold">clipper</p><p className="text-[8px] text-white/60">Original audio</p></div></div>
        <MoreHorizontal className="h-5 w-5" />
      </div>
      <PreviewMedia lookPresetId={lookPresetId} frameUrl={frameUrl} includeCaptions={includeCaptions} captionCue={captionCue} captionTime={captionTime} captionAppearance={captionAppearance} captionSafeZone={PLATFORM_SAFE_ZONES.instagram_feed} className="aspect-[4/5] w-full">
        {children}
      </PreviewMedia>
      <div className="space-y-2.5 px-3 pb-4 pt-3">
        <div className="flex items-center justify-between"><div className="flex gap-4"><Heart className="h-5 w-5" /><MessageCircle className="h-5 w-5" /><Send className="h-5 w-5" /></div><Bookmark className="h-5 w-5" /></div>
        <p className="text-[11px] font-bold">12,428 likes</p>
        <p className="text-[11px] leading-relaxed"><span className="mr-1 font-bold">clipper</span>{caption} <span className="font-semibold text-[#a8b7ca]">{hashtags.join(" ")}</span></p>
        <p className="text-[10px] text-white/50">View all 328 comments</p>
        <p className="text-[9px] uppercase tracking-wide text-white/40">2 minutes ago</p>
        <p className="sr-only">{title}</p>
      </div>
    </div>
  );
}

function XPostPreview({
  title,
  postText,
  hashtags,
  children,
  lookPresetId,
  frameUrl,
  includeCaptions,
  captionCue,
  captionTime,
  captionAppearance,
}: Omit<Parameters<typeof VerticalPlatformPreview>[0], "platform">) {
  return (
    <div className="w-full max-w-[620px] rounded-2xl border border-[#2f3336] bg-black p-4 text-white shadow-[0_22px_65px_rgba(0,0,0,0.45)]">
      <div className="flex gap-3">
        <PreviewAvatar size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1 text-[13px]"><span className="font-bold">Clipper</span><span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#1d9bf0] text-[8px] font-black">✓</span><span className="text-[#71767b]">@clipper · 2m</span><MoreHorizontal className="ml-auto h-5 w-5 text-[#71767b]" /></div>
          <p className="mt-1 text-[14px] leading-relaxed">{postText || title} <span className="text-[#1d9bf0]">{hashtags.join(" ")}</span></p>
          <PreviewMedia lookPresetId={lookPresetId} frameUrl={frameUrl} includeCaptions={includeCaptions} captionCue={captionCue} captionTime={captionTime} captionAppearance={captionAppearance} captionSafeZone={PLATFORM_SAFE_ZONES.x} className="mt-3 aspect-video w-full rounded-2xl border border-[#2f3336]">
            {children}
          </PreviewMedia>
          <div className="mt-3 flex items-center justify-between pr-5 text-[#71767b]">
            <span className="flex items-center gap-1.5 text-[11px]"><MessageCircle className="h-4 w-4" />328</span>
            <span className="flex items-center gap-1.5 text-[11px]"><Repeat2 className="h-4 w-4" />1.8K</span>
            <span className="flex items-center gap-1.5 text-[11px]"><Heart className="h-4 w-4" />12K</span>
            <span className="flex items-center gap-1.5 text-[11px]"><Share2 className="h-4 w-4" /></span>
          </div>
        </div>
      </div>
    </div>
  );
}

function YouTubeWatchPreview({
  title,
  description,
  hashtags,
  pinnedComment,
  children,
  lookPresetId,
  frameUrl,
  includeCaptions,
  captionCue,
  captionTime,
  captionAppearance,
}: Omit<Parameters<typeof VerticalPlatformPreview>[0], "platform">) {
  return (
    <div className="w-full max-w-[760px] overflow-hidden rounded-2xl border border-[#303030] bg-[#0f0f0f] text-white shadow-[0_24px_70px_rgba(0,0,0,0.5)]">
      <div className="flex h-12 items-center justify-between px-4"><div className="flex items-center gap-3"><Menu className="h-5 w-5" /><span className="text-base font-black tracking-[-0.04em]"><span className="mr-1 rounded bg-[#ff0033] px-1.5 py-0.5 text-[10px]">▶</span>YouTube</span></div><div className="flex items-center gap-4"><Search className="h-5 w-5" /><Bell className="h-5 w-5" /><PreviewAvatar size="sm" /></div></div>
      <PreviewMedia lookPresetId={lookPresetId} frameUrl={frameUrl} includeCaptions={includeCaptions} captionCue={captionCue} captionTime={captionTime} captionAppearance={captionAppearance} captionSafeZone={PLATFORM_SAFE_ZONES.youtube_landscape} className="aspect-video w-full">
        {children}
      </PreviewMedia>
      <div className="space-y-3 p-4">
        <h4 className="text-base font-bold leading-snug">{title}</h4>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2"><PreviewAvatar size="lg" /><div><p className="text-xs font-bold">Clipper</p><p className="text-[9px] text-white/55">48.2K subscribers</p></div><span className="ml-2 rounded-full bg-white px-3 py-1.5 text-[10px] font-bold text-black">Subscribe</span></div>
          <div className="flex gap-2"><span className="flex items-center gap-1 rounded-full bg-[#272727] px-3 py-1.5 text-[10px] font-semibold"><ThumbsUp className="h-4 w-4" />12K</span><span className="flex items-center gap-1 rounded-full bg-[#272727] px-3 py-1.5 text-[10px] font-semibold"><Share2 className="h-4 w-4" />Share</span></div>
        </div>
        <div className="rounded-xl bg-[#272727] p-3 text-[11px] leading-relaxed"><p className="font-bold">18K views · 2 minutes ago</p><p className="mt-1 line-clamp-2">{description} <span className="text-[#3ea6ff]">{hashtags.join(" ")}</span></p></div>
        <div className="flex items-start gap-2"><PreviewAvatar size="sm" /><div><p className="text-[9px] font-semibold text-white/55">Pinned by Clipper</p><p className="text-[11px]">{pinnedComment || "What was your favorite part?"}</p></div></div>
      </div>
    </div>
  );
}

export function PlatformPhoneFrame({
  platform,
  children,
  lookPresetId,
  frameUrl,
  includeCaptions,
  captionCue,
  captionTime,
  captionAppearance,
  copy,
}: {
  platform: PlatformKey;
  children?: ReactNode;
  lookPresetId: ContentLookPresetId;
  frameUrl: string | null;
  includeCaptions: boolean;
  captionCue: CaptionCue | null;
  captionTime: number;
  captionAppearance: CaptionAppearance;
  copy: PlatformCopy;
}) {
  const meta = PLATFORM_PRESETS[platform];
  const output = meta.outputs[0]!;
  const lookLabel = getContentLookPreset(lookPresetId).label;
  const details: PlatformPreviewDetails = {
    title: copy.title ?? "The moment everyone missed live",
    caption:
      copy.caption ??
      "A standout moment from the stream, clipped while it was happening.",
    postText: copy.postText ?? "",
    description: copy.description ?? copy.caption ?? "",
    hashtags: copy.hashtags,
    pinnedComment: copy.pinnedComment ?? "",
    captionCue,
    captionTime,
    captionAppearance,
  };

  const shared = {
    ...details,
    children,
    lookPresetId,
    frameUrl,
    includeCaptions,
  };

  let preview: ReactNode;
  if (
    platform === "youtube_shorts" ||
    platform === "tiktok" ||
    platform === "instagram_reels" ||
    platform === "facebook_reels"
  ) {
    preview = <VerticalPlatformPreview platform={platform} {...shared} />;
  } else if (platform === "instagram_feed") {
    preview = <InstagramFeedPreview {...shared} />;
  } else if (platform === "x") {
    preview = <XPostPreview {...shared} />;
  } else {
    preview = <YouTubeWatchPreview {...shared} />;
  }

  return (
    <div className="flex w-full flex-col items-center gap-3">
      {preview}
      <div className="flex flex-wrap items-center justify-center gap-2 text-[10px] text-[var(--color-muted)]">
        <span className="rounded-full border border-[var(--color-card-border)] bg-[var(--color-card)] px-2.5 py-1 font-semibold text-[var(--color-foreground)]">{meta.name}</span>
        <span>{output.aspectRatio} · {output.width}×{output.height}</span>
        <span>·</span>
        <span>{lookLabel} look</span>
      </div>
    </div>
  );
}

export function PlatformChipRow({
  platforms,
  value,
  onChange,
}: {
  platforms: PlatformKey[];
  value: PlatformKey;
  onChange: (key: PlatformKey) => void;
}) {
  return (
    <div
      className="flex w-full justify-start gap-2 overflow-x-auto px-0.5 pb-1 sm:justify-center [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      aria-label="Preview platform"
    >
      {platforms.map((key) => {
        const active = value === key;
        const label = PLATFORM_PRESETS[key].name;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            aria-label={label}
            aria-pressed={active}
            title={label}
            className={cn(
              "relative grid h-12 w-12 shrink-0 place-items-center border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]",
              active
                ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10"
                : "border-[var(--color-card-border)] bg-[var(--color-secondary)] hover:border-white/30 hover:bg-[var(--color-card)]"
            )}
          >
            <PlatformBrandIcon brand={key} size="sm" variant="mark" />
            {active && (
              <span className="absolute inset-x-2 -bottom-px h-0.5 bg-[var(--color-accent)]" />
            )}
            <span className="sr-only">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
