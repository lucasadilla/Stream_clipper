/** Max timeline span shown in the editor for a single live capture (48h). */
export const MAX_LIVE_TIMELINE_SECONDS = 48 * 3600;

/** Max VOD length we map onto the timeline (7 days). */
export const MAX_VOD_TIMELINE_SECONDS = 7 * 24 * 3600;

const DEFAULT_MAX = MAX_LIVE_TIMELINE_SECONDS;

export function sanitizeDurationSeconds(
  value: number | null | undefined,
  options?: { max?: number; fallback?: number }
): number {
  const max = options?.max ?? DEFAULT_MAX;
  const fallback = options?.fallback ?? 0;
  if (value === null || value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 0) return fallback;
  return Math.min(value, max);
}

/** Pick a safe timeline duration from several candidates. */
export function coalesceTimelineSeconds(
  values: Array<number | null | undefined>,
  options?: { max?: number }
): number {
  let best = 0;
  for (const value of values) {
    const safe = sanitizeDurationSeconds(value, { ...options, fallback: 0 });
    if (safe > best) best = safe;
  }
  return best;
}

/** Earliest plausible stream start (Twitch/YouTube epoch sanity). */
const MIN_STREAM_START_MS = Date.UTC(2010, 0, 1);

export function sanitizeStreamStartDate(
  value: Date | null | undefined
): Date | null {
  if (!value || Number.isNaN(value.getTime())) return null;
  const ms = value.getTime();
  const now = Date.now();
  if (ms < MIN_STREAM_START_MS || ms > now + 5 * 60_000) return null;
  return value;
}

export function sanitizeUnixTimestampSeconds(
  ts: number | null | undefined
): Date | null {
  if (typeof ts !== "number" || !Number.isFinite(ts) || ts <= 0) return null;
  // Heuristic: values > 1e12 are likely milliseconds.
  const ms = ts > 1e12 ? ts : ts * 1000;
  return sanitizeStreamStartDate(new Date(ms));
}
