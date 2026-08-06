"use client";

import {
  useEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
  type RefObject,
  type SyntheticEvent,
} from "react";
import {
  Gamepad2,
  MessagesSquare,
  MonitorPlay,
  ScanFace,
  WandSparkles,
} from "lucide-react";
import { cn } from "@/lib/cn";
import type { ContentLookPresetId } from "@/lib/contentLookPresets";
import { getContentLookPreset } from "@/lib/contentLookPresets";
import type { PlatformKey } from "@/lib/platforms/types";
import { PLATFORM_PRESETS } from "@/lib/platforms/presets";
import { PLATFORM_SAFE_ZONES } from "@/lib/platforms/safeZones";

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
  faceRect,
  faceCenterX,
}: {
  presetId: ContentLookPresetId;
  playbackUrl: string | null;
  videoRef: RefObject<HTMLVideoElement | null>;
  className?: string;
  children?: ReactNode;
  onTimeUpdate?: (event: SyntheticEvent<HTMLVideoElement>) => void;
  /** Normalized face box (0..1) — keeps the face centered in look crops. */
  faceRect?: { x: number; y: number; width: number; height: number } | null;
  /** Current tracked horizontal focus, normalized to 0..1. */
  faceCenterX?: number | null;
}) {
  const layout = getContentLookPreset(presetId).layout;
  const mirrorRef = useRef<HTMLVideoElement>(null);
  const needsMirror =
    layout === "facecam_top_gameplay_bottom" ||
    layout === "facecam_bottom_gameplay_top" ||
    layout === "facecam_pip" ||
    layout === "subject_aware_crop";

  const facePos = faceObjectPosition(faceRect, faceCenterX);

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
        : layout === "subject_aware_crop"
          ? "inset-y-0 left-[21%] right-[21%]"
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
    layout === "subject_aware_crop"
      ? "h-full w-full scale-110 object-cover opacity-35 blur-[2px] transition-[object-position] duration-500 ease-out motion-reduce:transition-none"
      : "h-full w-full scale-[1.85] object-cover transition-[object-position] duration-500 ease-out motion-reduce:transition-none";

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

      {playbackUrl && layout === "subject_aware_crop" && (
        <div className="pointer-events-none absolute inset-0 bg-black/55" />
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
          layout === "subject_aware_crop"
            ? "z-[1] shadow-[0_0_0_999px_rgba(0,0,0,0.55)]"
            : "z-[1]"
        )}
      >
        {playbackUrl ? (
          <video
            ref={videoRef}
            className={cn(
              primaryVideoClass,
              "transition-[object-position] duration-500 ease-out motion-reduce:transition-none"
            )}
            style={{
              objectPosition:
                layout === "subject_aware_crop" ||
                layout === "center_crop" ||
                layout === "auto" ||
                layout === "gameplay_full"
                  ? facePos
                  : "center",
            }}
            playsInline
            controls
            onTimeUpdate={onTimeUpdate}
          />
        ) : null}
      </div>

      <div className="pointer-events-none absolute inset-0 z-10">{children}</div>
    </div>
  );
}

function faceObjectPosition(
  faceRect?: { x: number; y: number; width: number; height: number } | null,
  trackedCenterX?: number | null
): string {
  const trackedX =
    typeof trackedCenterX === "number" && Number.isFinite(trackedCenterX)
      ? Math.min(1, Math.max(0, trackedCenterX))
      : null;
  if (
    !faceRect ||
    !Number.isFinite(faceRect.x) ||
    !Number.isFinite(faceRect.y) ||
    faceRect.width <= 0 ||
    faceRect.height <= 0
  ) {
    return `${((trackedX ?? 0.5) * 100).toFixed(1)}% 42%`;
  }
  const cx =
    trackedX ??
    Math.min(1, Math.max(0, faceRect.x + faceRect.width / 2));
  const cy = Math.min(1, Math.max(0, faceRect.y + faceRect.height / 2));
  return `${(cx * 100).toFixed(1)}% ${(cy * 100).toFixed(1)}%`;
}

const PLATFORM_SHORT: Partial<Record<PlatformKey, string>> = {
  youtube_shorts: "Shorts",
  tiktok: "TikTok",
  instagram_reels: "Reels",
  instagram_feed: "IG Feed",
  facebook_reels: "FB Reels",
  x: "X",
  youtube_landscape: "YouTube",
};

export function PlatformPhoneFrame({
  platform,
  children,
  lookPresetId,
  frameUrl,
  includeCaptions,
}: {
  platform: PlatformKey;
  children?: ReactNode;
  lookPresetId: ContentLookPresetId;
  frameUrl: string | null;
  includeCaptions: boolean;
}) {
  const meta = PLATFORM_PRESETS[platform];
  const output = meta.outputs[0]!;
  const safe = PLATFORM_SAFE_ZONES[platform];
  const [w, h] = output.aspectRatio.split(":").map(Number);
  const aspect = w && h ? `${w} / ${h}` : "9 / 16";
  const isVertical = (h ?? 16) >= (w ?? 9);
  const lookLabel = getContentLookPreset(lookPresetId).label;

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className={cn(
          "relative overflow-hidden bg-black shadow-[0_24px_70px_rgba(0,0,0,0.6)]",
          isVertical
            ? "w-[min(100%,280px)] rounded-[2.1rem] border-[8px] border-[#121412]"
            : "w-[min(100%,520px)] rounded-2xl border-[6px] border-[#121412]"
        )}
        style={{ aspectRatio: aspect }}
      >
        {isVertical && (
          <div className="pointer-events-none absolute left-1/2 top-2 z-20 h-5 w-24 -translate-x-1/2 rounded-full bg-[#0a0c0a]" />
        )}

        <div className="absolute inset-0">
          {children ?? (
            <LookLayoutMock
              presetId={lookPresetId}
              frameUrl={frameUrl}
              className="h-full w-full rounded-none border-0"
            />
          )}
        </div>

        <div className="pointer-events-none absolute inset-0 z-10 bg-gradient-to-b from-black/45 via-transparent to-black/50" />
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between px-4 pt-3.5 text-[11px] font-medium text-white/90">
          <span className="font-semibold tracking-wide">
            {PLATFORM_SHORT[platform] ?? meta.name}
          </span>
          <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] backdrop-blur-sm">
            {lookLabel}
          </span>
        </div>

        {isVertical &&
          (platform === "tiktok" ||
            platform === "instagram_reels" ||
            platform === "youtube_shorts") && (
            <div className="pointer-events-none absolute bottom-[22%] right-3 z-10 flex flex-col items-center gap-3">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-8 w-8 rounded-full bg-white/20 backdrop-blur-sm"
                />
              ))}
            </div>
          )}

        {includeCaptions && (
          <div
            className="pointer-events-none absolute inset-x-5 z-10 text-center"
            style={{
              bottom: `${Math.max(12, safe.subtitleBottomPercent - 2)}%`,
            }}
          >
            <span className="inline-block rounded-md bg-black/60 px-2.5 py-1 text-[11px] font-semibold leading-snug text-white shadow-lg backdrop-blur-sm">
              Caption lands here
            </span>
          </div>
        )}

        {isVertical && (
          <div className="pointer-events-none absolute bottom-2.5 left-1/2 z-10 h-1 w-28 -translate-x-1/2 rounded-full bg-white/40" />
        )}
      </div>
      <p className="text-[11px] text-[var(--color-muted)]">
        {meta.name} · {output.aspectRatio}
      </p>
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
    <div className="flex justify-center gap-1.5 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {platforms.map((key) => {
        const active = value === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            className={cn(
              "shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition",
              active
                ? "bg-[var(--color-accent)] text-black shadow-[0_0_0_1px_var(--color-accent)]"
                : "bg-[#141814] text-[var(--color-muted)] hover:bg-[#1a1f1a] hover:text-white"
            )}
          >
            {PLATFORM_SHORT[key] ?? PLATFORM_PRESETS[key].name}
          </button>
        );
      })}
    </div>
  );
}
