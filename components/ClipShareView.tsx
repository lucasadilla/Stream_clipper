"use client";

import { useState } from "react";
import Link from "next/link";
import { formatDuration, formatSeconds } from "@/lib/time";
import { clipDownloadUrl } from "@/lib/downloadUrls";
import { clipShareUrl } from "@/lib/clipShare";
import { triggerFileDownload } from "@/lib/clientDownload";
import type { ClipSharePayload } from "@/services/clipShareService";
import { cn } from "@/lib/utils";

interface ClipShareViewProps {
  clip: ClipSharePayload;
}

export function ClipShareView({ clip }: ClipShareViewProps) {
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const shareUrl =
    typeof window !== "undefined"
      ? clipShareUrl(clip.id, window.location.origin)
      : clipShareUrl(clip.id);

  async function copyLink() {
    const url =
      typeof window !== "undefined"
        ? clipShareUrl(clip.id, window.location.origin)
        : clip.sharePath;
    await navigator.clipboard.writeText(
      url.startsWith("http") ? url : `${window.location.origin}${clip.sharePath}`
    );
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  async function handleDownload() {
    if (!clip.downloadUrl) return;
    setDownloading(true);
    try {
      const safeName = `${clip.title.slice(0, 40).replace(/[^\w\s-]/g, "") || "clip"}.mp4`;
      await triggerFileDownload(clipDownloadUrl(clip.id), safeName);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="editor-shell min-h-screen bg-[var(--color-background)] text-[var(--color-foreground)]">
      <header className="border-b border-[var(--color-card-border)] bg-[#020302]/92 backdrop-blur-sm">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-3">
          <Link
            href="/"
            className="text-sm font-semibold text-[var(--color-foreground)] hover:text-[var(--color-accent)]"
          >
            Stream Clipper
          </Link>
          <button
            type="button"
            onClick={() => void copyLink()}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors",
              copied
                ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-black"
                : "border-[var(--color-card-border)] text-[var(--color-muted)] hover:border-[var(--color-accent)] hover:text-white"
            )}
          >
            {copied ? "Link copied" : "Copy link"}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-6 px-4 py-8">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-accent)]">
            Shared clip
            {clip.stream.channelTitle ? ` / ${clip.stream.channelTitle}` : ""}
          </p>
          <h1 className="max-w-3xl text-3xl font-black leading-[0.95] tracking-normal text-white sm:text-5xl">
            {clip.title}
          </h1>
          {clip.stream.title && (
            <p className="max-w-2xl text-sm text-[var(--color-muted)]">
              From: {clip.stream.title}
            </p>
          )}
        </div>

        <div className="overflow-hidden rounded-lg border border-[var(--color-card-border)] bg-black shadow-[0_20px_90px_rgba(0,0,0,0.48)]">
          {clip.hasVideo && clip.videoUrl ? (
            <video
              src={clip.videoUrl}
              controls
              playsInline
              preload="metadata"
              className="max-h-[min(70vh,720px)] w-full bg-black object-contain"
              poster={clip.stream.thumbnailUrl ?? undefined}
            />
          ) : (
            <div className="relative mx-auto flex aspect-[9/16] max-h-[min(70vh,720px)] flex-col items-center justify-center bg-[#020302] p-6 text-center">
              {clip.stream.thumbnailUrl && (
                <img
                  src={clip.stream.thumbnailUrl}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover opacity-20"
                />
              )}
              <p className="relative max-w-xs text-sm text-[var(--color-muted)]">
                Video preview is not ready yet. Ask the editor to export this
                clip first.
              </p>
            </div>
          )}
        </div>

        <div className="space-y-3 border-t border-[var(--color-card-border)] pt-5">
          <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--color-muted)]">
            <span>
              {formatSeconds(clip.startTimeSeconds)} to{" "}
              {formatSeconds(clip.endTimeSeconds)}
            </span>
            <span>{formatDuration(clip.durationSeconds)}</span>
          </div>

          <p className="max-w-3xl text-sm leading-relaxed text-[#dfead8]">
            {clip.reason}
          </p>

          <div className="flex flex-wrap gap-2 pt-1">
            {clip.hasVideo && (
              <button
                type="button"
                onClick={() => void handleDownload()}
                disabled={downloading}
                className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
              >
                {downloading ? "Downloading..." : "Download MP4"}
              </button>
            )}
            <button
              type="button"
              onClick={() => void copyLink()}
              className="rounded-lg border border-[var(--color-card-border)] px-4 py-2 text-sm font-semibold text-[var(--color-muted)] transition-colors hover:border-[var(--color-accent)] hover:text-white"
            >
              {copied ? "Copied!" : "Copy share link"}
            </button>
          </div>

          <p className="break-all pt-1 text-[10px] text-[var(--color-muted)]">
            {shareUrl.startsWith("http") ? shareUrl : clip.sharePath}
          </p>
        </div>
      </main>
    </div>
  );
}
