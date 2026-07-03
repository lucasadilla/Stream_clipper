/** Seconds between each filmstrip frame (wider = fewer frames, faster ffmpeg). */
export const THUMB_INTERVAL_SECONDS = 30;

/** How much timeline to extract per ffmpeg pass (smaller = thumbs appear sooner). */
export const THUMB_SYNC_CHUNK_SECONDS = 3 * 60;

/** Live: prioritize the recent edge once recording exceeds this length. */
export const THUMB_LIVE_TAIL_PRIORITY_SECONDS = 3 * 60;

/** JPEG width for timeline filmstrip (~1.5 KB/frame at q=9). */
export const THUMB_WIDTH_PX = 96;

/** Client poll interval while the editor is open. */
export const THUMB_POLL_MS = 2000;

/** Strip passes per background sync (2 × 3 min = up to 6 min per cycle). */
export const THUMB_SYNC_PASSES = 2;
