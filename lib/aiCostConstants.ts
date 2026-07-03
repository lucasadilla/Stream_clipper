/**
 * Cost-control knobs for OpenAI usage (Whisper, embeddings, chat).
 * Keyword transcript search works without embeddings — keep those off by default.
 */

/** Merge Whisper segments — keep short for accurate caption timing. */
export const TRANSCRIPT_MERGE_MAX_SECONDS = 8;

/** Embed transcript chunks at ingest (1 API call per batch). Keyword search does not need this. */
export const EMBED_TRANSCRIPT_CHUNKS = false;

/** Embed chat hype windows during live-tick (very expensive — re-ran every poll). */
export const EMBED_CHAT_WINDOWS = false;

/** Vector similarity on /ask (1 embedding per user question). */
export const USE_VECTOR_SEARCH_ON_ASK = false;

/**
 * When keyword search finds matches, skip GPT and return the best excerpt directly.
 * Set false to always use GPT for nicer phrasing (small cost per question).
 */
export const USE_KEYWORD_FAST_PATH = true;

/** Min keyword hits before skipping the GPT call on /ask. */
export const KEYWORD_FAST_PATH_MIN_HITS = 1;

/** Min relevance score (0–1) for keyword fast path — weak matches go to GPT. */
export const KEYWORD_FAST_PATH_MIN_SIMILARITY = 0.45;
