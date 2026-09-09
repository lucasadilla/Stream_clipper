"use client";

import { fetchJson } from "@/lib/apiClient";
import type { CaptionEditsMap } from "@/lib/captionEdits";
import type { TranscriptChunkInput } from "@/lib/captionTrack";
import { loadBrowserFaceDetector } from "@/lib/browserFaceTracking";

export interface ClipStudioCaptionBundle {
  chunks: TranscriptChunkInput[];
  edits: CaptionEditsMap;
}

const CACHE_TTL_MS = 2 * 60 * 1000;
const captionCache = new Map<
  string,
  { expiresAt: number; bundle: ClipStudioCaptionBundle }
>();
const captionRequests = new Map<string, Promise<ClipStudioCaptionBundle>>();
const warmedPlaybackUrls = new Set<string>();

function captionKey(sessionId: string, startSeconds: number, endSeconds: number) {
  return `${sessionId}:${startSeconds.toFixed(2)}:${endSeconds.toFixed(2)}`;
}

export function loadClipStudioCaptions(
  sessionId: string,
  startSeconds: number,
  endSeconds: number
): Promise<ClipStudioCaptionBundle> {
  const key = captionKey(sessionId, startSeconds, endSeconds);
  const cached = captionCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return Promise.resolve(cached.bundle);
  }

  const existing = captionRequests.get(key);
  if (existing) return existing;

  const request = Promise.all([
    fetchJson<{ transcriptChunks?: TranscriptChunkInput[] }>(
      `/api/sessions/${sessionId}/events?start=${encodeURIComponent(
        Math.max(0, startSeconds - 120)
      )}&end=${encodeURIComponent(endSeconds + 120)}`
    ),
    fetchJson<{ edits?: CaptionEditsMap }>(
      `/api/sessions/${sessionId}/captions`
    ),
  ])
    .then(([events, captions]) => {
      const bundle = {
        chunks: events.ok ? events.data.transcriptChunks ?? [] : [],
        edits: captions.ok ? captions.data.edits ?? {} : {},
      } satisfies ClipStudioCaptionBundle;
      captionCache.set(key, {
        expiresAt: Date.now() + CACHE_TTL_MS,
        bundle,
      });
      return bundle;
    })
    .finally(() => captionRequests.delete(key));

  captionRequests.set(key, request);
  return request;
}

export function updateClipStudioCaptionCache(
  sessionId: string,
  startSeconds: number,
  endSeconds: number,
  edits: CaptionEditsMap
) {
  const key = captionKey(sessionId, startSeconds, endSeconds);
  const cached = captionCache.get(key);
  if (!cached) return;
  captionCache.set(key, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    bundle: { ...cached.bundle, edits },
  });
}

function warmPlaybackMetadata(playbackUrl: string | null | undefined) {
  if (!playbackUrl || typeof document === "undefined") return;
  if (warmedPlaybackUrls.has(playbackUrl)) return;
  warmedPlaybackUrls.add(playbackUrl);

  const video = document.createElement("video");
  video.preload = "metadata";
  video.muted = true;
  video.playsInline = true;
  video.src = playbackUrl;
  video.load();

  window.setTimeout(() => {
    video.removeAttribute("src");
    video.load();
    warmedPlaybackUrls.delete(playbackUrl);
  }, 60_000);
}

export function preloadClipStudioFaceTracker() {
  void loadBrowserFaceDetector().catch(() => undefined);
}

export function preloadClipStudio(options: {
  sessionId: string;
  startSeconds: number;
  endSeconds: number;
  playbackUrl?: string | null;
}) {
  preloadClipStudioFaceTracker();
  void loadClipStudioCaptions(
    options.sessionId,
    options.startSeconds,
    options.endSeconds
  ).catch(() => undefined);
  warmPlaybackMetadata(options.playbackUrl);
}
