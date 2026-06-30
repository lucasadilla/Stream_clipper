/** Seconds of audio per Whisper API call (~90s ≈ 2.9 MB WAV). */
export const TRANSCRIPTION_CHUNK_SECONDS = 90;

/** Max seconds transcribed per /transcribe request (~1–2 Whisper calls, finishes in <60s). */
export const TRANSCRIPTION_BUDGET_LIVE_SECONDS = 90;
export const TRANSCRIPTION_BUDGET_VOD_SECONDS = 180;

/** One Whisper call at a time — avoids timeouts and API rate limits. */
export const TRANSCRIPTION_PARALLEL = 1;

/** Poll transcribe endpoint while behind recorded audio. */
export const TRANSCRIPTION_FAST_TICK_MS = 5000;

/** Backlog before skipping thumbnails during live-tick. */
export const TRANSCRIPTION_HEAVY_BACKLOG_SECONDS = 90;
