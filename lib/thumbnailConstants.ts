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

/**
 * Live Kick/Twitch from-start: first strip/bootstrap window — keep this short
 * so stream-start paints in a couple seconds.
 */
export const THUMB_LIVE_FIRST_CHUNK_SECONDS = 2 * 60;

/**
 * Follow-up live strip window after the first paint.
 */
export const THUMB_LIVE_STRIP_CHUNK_SECONDS = 12 * 60;

/**
 * Editor prepare for live: score filmstrip against this window, not the full
 * multi-hour backlog Kick VOD catch-up can dump immediately.
 */
export const THUMB_LIVE_READY_WINDOW_SECONDS = 90;

/**
 * ≤ this many missing blocks → parallel keyframe grabs (same 96px/q=9 as strip).
 * Faster than a multi-minute strip decode for the first paint.
 */
export const THUMB_PARALLEL_BOOTSTRAP_MAX = 8;

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
 * Strip passes per background sync. Live uses more short passes so each poll
 * advances the head without one long ffmpeg walk.
 */
export const THUMB_SYNC_PASSES = 2;
export const THUMB_SYNC_PASSES_LIVE = 4;

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

/** Keep only blocks inside the next strip chunk (head-first). */
export function limitThumbBlocksToChunk(
  blocks: number[],
  chunkSeconds: number
): number[] {
  if (blocks.length === 0 || chunkSeconds <= 0) return blocks;
  const origin = blocks[0]!;
  const end = origin + chunkSeconds;
  return blocks.filter((start) => start < end);
}
