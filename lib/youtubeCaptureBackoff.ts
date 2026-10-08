import { extractYouTubeVideoId } from "@/lib/youtube";

// Shared by sessions and background workers in this server process. A failed
// companion request must not prevent the main downloader trying other clients.
const failures = new Map<string, { until: number; count: number; exhausted: boolean }>();
const INITIAL_DELAY_MS = 5 * 60_000;
const MAX_DELAY_MS = 30 * 60_000;

export class YoutubeCapturePausedError extends Error {
  constructor(public readonly retryAt: number) {
    super(`YouTube is refusing capture from this server. Automatic retries are paused for ${Math.max(1, Math.ceil((retryAt - Date.now()) / 60_000))} minutes. You can upload the video file instead.`);
    this.name = "YoutubeCapturePausedError";
  }
}

export function youtubeCaptureRetryAt(url: string, background = false): number | null {
  const id = extractYouTubeVideoId(url);
  const state = id ? failures.get(id) : undefined;
  return state && state.until > Date.now() && (background || state.exhausted)
    ? state.until : null;
}

export function recordYoutubeCaptureChallenge(url: string, exhausted = false): void {
  const id = extractYouTubeVideoId(url);
  if (!id) return;
  const prior = failures.get(id);
  const alreadyPaused = prior && prior.until > Date.now();
  const count = alreadyPaused ? prior.count : Math.min(4, (prior?.count ?? 0) + 1);
  failures.set(id, {
    count,
    until: alreadyPaused ? prior.until : Date.now() + Math.min(MAX_DELAY_MS, INITIAL_DELAY_MS * 2 ** (count - 1)),
    exhausted: exhausted || Boolean(alreadyPaused && prior.exhausted),
  });
  // Bound memory even when users submit many distinct unavailable sources.
  if (failures.size > 500) failures.delete(failures.keys().next().value!);
}

export function clearYoutubeCaptureChallenge(url: string): void {
  const id = extractYouTubeVideoId(url);
  if (id) failures.delete(id);
}
