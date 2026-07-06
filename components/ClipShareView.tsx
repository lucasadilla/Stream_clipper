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
    <div className="min-h-screen site-body">
      <header className="border-b border-[var(--color-card-border)] bg-[var(--color-card)]/80 backdrop-blur-sm">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
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
              "text-xs px-3 py-1.5 rounded-full border transition-colors",
              copied
                ? "border-[var(--color-success)] text-[var(--color-success)]"
                : "border-[var(--color-card-border)] text-[var(--color-muted)] hover:text-white hover:border-[var(--color-accent)]"
            )}
          >
            {copied ? "Link copied" : "Copy link"}
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
            Shared clip
            {clip.stream.channelTitle ? ` · ${clip.stream.channelTitle}` : ""}
          </p>
          <h1 className="text-2xl sm:text-3xl font-bold leading-tight">
            {clip.title}
          </h1>
          {clip.stream.title && (
            <p className="text-sm text-[var(--color-muted)]">
              From: {clip.stream.title}
            </p>
          )}
        </div>

        <div className="rounded-2xl overflow-hidden border border-[var(--color-card-border)] bg-black shadow-xl">
          {clip.hasVideo && clip.videoUrl ? (
            <video
              src={clip.videoUrl}
              controls
              playsInline
              preload="metadata"
              className="w-full max-h-[min(70vh,720px)] bg-black object-contain"
              poster={clip.stream.thumbnailUrl ?? undefined}
            />
          ) : (
            <div className="relative aspect-[9/16] max-h-[min(70vh,720px)] mx-auto bg-[#0d0d12] flex flex-col items-center justify-center p-6 text-center">
              {clip.stream.thumbnailUrl && (
                <img
                  src={clip.stream.thumbnailUrl}
                  alt=""
                  className="absolute inset-0 w-full h-full object-cover opacity-20"
                />
              )}
              <p className="relative text-sm text-[var(--color-muted)] max-w-xs">
                Video preview isn&apos;t ready yet. Ask the editor to export this
                clip first.
              </p>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)] p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--color-muted)]">
            <span>
              {formatSeconds(clip.startTimeSeconds)} –{" "}
              {formatSeconds(clip.endTimeSeconds)}
            </span>
            <span>{formatDuration(clip.durationSeconds)}</span>
          </div>

          <p className="text-sm text-[var(--color-foreground)] leading-relaxed">
            {clip.reason}
          </p>

          <div className="flex flex-wrap gap-2 pt-1">
            {clip.hasVideo && (
              <button
                type="button"
                onClick={() => void handleDownload()}
                disabled={downloading}
                className="text-sm px-4 py-2 rounded-lg font-semibold bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white disabled:opacity-50"
              >
                {downloading ? "Downloading…" : "Download MP4"}
              </button>
            )}
            <button
              type="button"
              onClick={() => void copyLink()}
              className="text-sm px-4 py-2 rounded-lg border border-[var(--color-card-border)] hover:border-[var(--color-accent)]"
            >
              {copied ? "Copied!" : "Copy share link"}
            </button>
          </div>

          <p className="text-[10px] text-[var(--color-muted)] break-all pt-1">
            {shareUrl.startsWith("http") ? shareUrl : clip.sharePath}
          </p>
        </div>
      </main>
    </div>
  );
}
