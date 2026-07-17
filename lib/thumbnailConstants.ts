/** Minimum seconds between sparse filmstrip frames. */
export const THUMB_MIN_INTERVAL_SECONDS = 30;

/** Target frame count for a full-session sparse filmstrip (fast first paint). */
export const THUMB_TARGET_FRAME_COUNT = 48;

/** Hard cap so a single strip pass stays cheap. */
export const THUMB_MAX_FRAME_COUNT = 64;

/**
 * @deprecated Prefer thumbIntervalForDuration — kept for callers that need a
 * fallback numeric constant. Sparse mode uses adaptive spacing.
 */
export const THUMB_INTERVAL_SECONDS = THUMB_MIN_INTERVAL_SECONDS;

/**
 * How much timeline to extract per ffmpeg pass when the sparse set does not
 * fit in one shot (rare for VODs ≤ ~THUMB_MAX_FRAME_COUNT * interval).
 */
export const THUMB_SYNC_CHUNK_SECONDS = 6 * 60 * 60;

/** Live: prioritize the recent edge once recording exceeds this length. */
export const THUMB_LIVE_TAIL_PRIORITY_SECONDS = 3 * 60;

/** JPEG width for timeline filmstrip (~1.5 KB/frame at q=9). */
export const THUMB_WIDTH_PX = 96;

/**
 * Solo / gap-fill stills are one image at a time — use a larger, sharper
 * encode so stretched filmstrip frames look less blocky.
 */
export const THUMB_SOLO_WIDTH_PX = 320;

/** JPEG quality 2–5 is high; 9 is tiny strip quality. */
export const THUMB_SOLO_QUALITY = 3;

/** Client poll interval while the editor is open. */
export const THUMB_POLL_MS = 2000;

/**
 * Strip passes per background sync. Sparse mode usually finishes in 1 pass;
 * keep a small budget for live growth / retries.
 */
export const THUMB_SYNC_PASSES = 2;

/** Adaptive spacing: ~48 frames across the session, never denser than 30s. */
export function thumbIntervalForDuration(durationSeconds: number): number {
  const duration = Math.max(0, durationSeconds);
  if (duration < 2) return THUMB_MIN_INTERVAL_SECONDS;
  const raw = duration / THUMB_TARGET_FRAME_COUNT;
  return Math.max(THUMB_MIN_INTERVAL_SECONDS, Math.ceil(raw));
}

/** How many sparse frames we expect for this duration. */
export function expectedThumbCountForDuration(durationSeconds: number): number {
  const duration = Math.max(0, durationSeconds);
  if (duration < 2) return 0;
  const interval = thumbIntervalForDuration(duration);
  return Math.min(
    THUMB_MAX_FRAME_COUNT,
    Math.max(1, Math.ceil(duration / interval))
  );
}

/** Aligned block starts for a sparse filmstrip covering [0, duration). */
export function sparseThumbStarts(durationSeconds: number): number[] {
  const duration = Math.max(0, durationSeconds);
  if (duration < 2) return [];
  const interval = thumbIntervalForDuration(duration);
  const count = expectedThumbCountForDuration(duration);
  const starts: number[] = [];
  for (let i = 0; i < count; i++) {
    const start = i * interval;
    if (start >= duration) break;
    starts.push(start);
  }
  if (starts.length === 0) starts.push(0);
  return starts;
}
