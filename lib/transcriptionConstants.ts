/** Seconds of audio per Whisper API call (~45s keeps timestamp error low without segments). */
export const TRANSCRIPTION_CHUNK_SECONDS = 45;

/** Max seconds transcribed per /transcribe request. */
export const TRANSCRIPTION_BUDGET_LIVE_SECONDS = 180;
export const TRANSCRIPTION_BUDGET_VOD_SECONDS = 360;

/** Whisper calls in flight per wave. */
export const TRANSCRIPTION_PARALLEL = 2;

/** Poll /transcribe while audio backlog exists. */
export const TRANSCRIPTION_FAST_TICK_MS = 8000;

/** Poll /transcribe when caught up (live or VOD). */
export const TRANSCRIPTION_SLOW_TICK_MS = 30000;

/** Backlog before skipping thumbnails during live-tick. */
export const TRANSCRIPTION_HEAVY_BACKLOG_SECONDS = 120;
