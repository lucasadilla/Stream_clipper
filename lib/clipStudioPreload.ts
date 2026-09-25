"use client";

import { fetchJson } from "@/lib/apiClient";
import type { CaptionEditsMap } from "@/lib/captionEdits";
import type { TranscriptChunkInput } from "@/lib/captionTrack";
import { loadBrowserFaceDetector } from "@/lib/browserFaceTracking";
import type { SpeakerContext } from "@/lib/speakerContext";

export interface ClipStudioCaptionBundle {
  chunks: TranscriptChunkInput[];
  edits: CaptionEditsMap;
  speakerContext: SpeakerContext | null;
  coverageStartSeconds: number;
  coverageEndSeconds: number;
}

const CACHE_TTL_MS = 2 * 60 * 1000;
const CAPTION_WINDOW_SECONDS = 120;
const CAPTION_PADDING_SECONDS = 120;
const captionCache = new Map<
  string,
  { expiresAt: number; bundle: ClipStudioCaptionBundle }
>();
const captionRequests = new Map<string, Promise<ClipStudioCaptionBundle>>();
const warmedPlaybackUrls = new Set<string>();

export function getClipStudioCaptionWindow(
  startSeconds: number,
  endSeconds: number
) {
  const paddedStart = Math.max(0, startSeconds - CAPTION_PADDING_SECONDS);
  const paddedEnd = Math.max(endSeconds, startSeconds) + CAPTION_PADDING_SECONDS;
  return {
    startSeconds:
      Math.floor(paddedStart / CAPTION_WINDOW_SECONDS) * CAPTION_WINDOW_SECONDS,
    endSeconds:
      Math.ceil(paddedEnd / CAPTION_WINDOW_SECONDS) * CAPTION_WINDOW_SECONDS,
  };
}

function captionKey(sessionId: string, startSeconds: number, endSeconds: number) {
  const window = getClipStudioCaptionWindow(startSeconds, endSeconds);
  return `${sessionId}:${window.startSeconds}:${window.endSeconds}`;
}

export function loadClipStudioCaptions(
  sessionId: string,
  startSeconds: number,
  endSeconds: number,
  options?: { forceRefresh?: boolean }
): Promise<ClipStudioCaptionBundle> {
  const window = getClipStudioCaptionWindow(startSeconds, endSeconds);
  const key = captionKey(sessionId, startSeconds, endSeconds);
  const cached = captionCache.get(key);
  if (!options?.forceRefresh && cached && cached.expiresAt > Date.now()) {
    return Promise.resolve(cached.bundle);
  }

  const existing = captionRequests.get(key);
  if (!options?.forceRefresh && existing) return existing;

  // Resolve speaker identity first so the following transcript read observes
  // the cached word-level assignments written by SpeakerContextService.
  const request: Promise<ClipStudioCaptionBundle> = fetchJson<{
    context?: SpeakerContext;
  }>(`/api/sessions/${sessionId}/speakers`)
    .then(async (speakers) => {
      const [events, captions] = await Promise.all([
        fetchJson<{ transcriptChunks?: TranscriptChunkInput[] }>(
          `/api/sessions/${sessionId}/events?start=${encodeURIComponent(
            window.startSeconds
          )}&end=${encodeURIComponent(window.endSeconds)}`
        ),
        fetchJson<{ edits?: CaptionEditsMap }>(
          `/api/sessions/${sessionId}/captions`
        ),
      ]);
      const bundle = {
        chunks: events.ok ? events.data.transcriptChunks ?? [] : [],
        edits: captions.ok ? captions.data.edits ?? {} : {},
        speakerContext: speakers.ok ? speakers.data.context ?? null : null,
        coverageStartSeconds: window.startSeconds,
        coverageEndSeconds: window.endSeconds,
      } satisfies ClipStudioCaptionBundle;
      if (!captionRequests.has(key) || captionRequests.get(key) === request) {
        captionCache.set(key, {
          expiresAt: Date.now() + CACHE_TTL_MS,
          bundle,
        });
      }
      return bundle;
    })
    .finally(() => {
      if (captionRequests.get(key) === request) captionRequests.delete(key);
    });

  captionRequests.set(key, request);
  return request;
}

export function invalidateClipStudioCaptionCache(sessionId: string) {
  const prefix = `${sessionId}:`;
  for (const key of captionCache.keys()) {
    if (key.startsWith(prefix)) captionCache.delete(key);
  }
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
