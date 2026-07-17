import { expectedThumbCountForDuration } from "@/lib/thumbnailConstants";

/** Timeline filmstrip + transcript should cover this fraction before opening. */
export const EDITOR_READY_RATIO = 0.9;

/** Don't apply the 90% rule until we have at least this much media. */
export const EDITOR_READY_MIN_SECONDS = 20;

/**
 * Hard cap so a stuck source/transcription never traps the user.
 * After this, open the editor with whatever is ready.
 */
export const EDITOR_PREPARE_MAX_MS = 3 * 60 * 1000;

/**
 * Once the filmstrip is ready, don't wait forever on transcript (common when
 * the capture is video-only DASH and companion audio is still starting).
 */
export const EDITOR_TRANSCRIPT_GRACE_MS = 25_000;

export function editorPreparedStorageKey(sessionId: string): string {
  return `clipper:editorPrepared:${sessionId}`;
}

export function readEditorPreparedFlag(sessionId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return sessionStorage.getItem(editorPreparedStorageKey(sessionId)) === "1";
  } catch {
    return false;
  }
}

export function writeEditorPreparedFlag(sessionId: string, prepared: boolean): void {
  if (typeof window === "undefined") return;
  try {
    const key = editorPreparedStorageKey(sessionId);
    if (prepared) sessionStorage.setItem(key, "1");
    else sessionStorage.removeItem(key);
  } catch {
    // private mode / quota
  }
}

export interface EditorReadinessInput {
  recordedSeconds: number;
  transcribedSeconds: number;
  thumbnails: Array<{ endTimeSeconds: number }>;
  prepareElapsedMs: number;
  hasSourceError?: boolean;
  /** Session was already opened successfully earlier in this tab. */
  previouslyPrepared?: boolean;
  /** Live status from /transcribe (e.g. no_audio, audio_not_ready). */
  transcriptionHint?: string | null;
}

export interface EditorReadiness {
  ready: boolean;
  forcedByTimeout: boolean;
  transcriptRatio: number;
  thumbRatio: number;
  overallRatio: number;
  recordedSeconds: number;
  transcribedSeconds: number;
  thumbCoveredSeconds: number;
  expectedThumbCount: number;
  thumbCount: number;
  statusMessage: string;
  detailMessage: string;
  /** Soft-open: filmstrip met, transcript still catching up. */
  openingWithoutFullTranscript: boolean;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
}

export function computeEditorReadiness(
  input: EditorReadinessInput
): EditorReadiness {
  const recorded = Math.max(0, input.recordedSeconds);
  const transcribed = Math.max(0, input.transcribedSeconds);
  const thumbCoveredSeconds = Math.max(
    0,
    ...input.thumbnails.map((t) => t.endTimeSeconds),
    0
  );
  const expectedThumbCount = expectedThumbCountForDuration(recorded);
  const thumbCount = input.thumbnails.length;

  const thumbByTime =
    recorded > 0 ? clamp01(thumbCoveredSeconds / recorded) : 0;
  const thumbByCount =
    expectedThumbCount > 0 ? clamp01(thumbCount / expectedThumbCount) : 0;
  const thumbRatio = Math.max(thumbByTime, thumbByCount);
  const transcriptRatio =
    recorded > 0 ? clamp01(transcribed / recorded) : 0;
  const overallRatio = (thumbRatio + transcriptRatio) / 2;

  const forcedByTimeout = input.prepareElapsedMs >= EDITOR_PREPARE_MAX_MS;
  const thumbsReady = thumbRatio >= EDITOR_READY_RATIO;
  const transcriptReady = transcriptRatio >= EDITOR_READY_RATIO;
  const transcriptGraceElapsed =
    input.prepareElapsedMs >= EDITOR_TRANSCRIPT_GRACE_MS;

  let ready = false;
  let openingWithoutFullTranscript = false;

  if (forcedByTimeout) {
    ready = true;
    openingWithoutFullTranscript = !transcriptReady;
  } else if (input.hasSourceError && input.prepareElapsedMs >= 15_000) {
    ready = true;
  } else if (input.previouslyPrepared) {
    // Refresh / remount: wait for filmstrip or transcript, with a short
    // fallback so a wiped session cannot trap the restore screen forever.
    ready =
      (recorded >= 2 && (thumbCount > 0 || transcribed > 0)) ||
      (recorded >= 2 && input.prepareElapsedMs >= 20_000);
  } else if (recorded < 2) {
    ready = false;
  } else if (recorded < EDITOR_READY_MIN_SECONDS) {
    const hasThumb = thumbCount > 0 || thumbRatio >= 0.5;
    const hasTranscript = transcribed > 0 || transcriptRatio >= 0.5;
    if (hasThumb && hasTranscript) {
      ready = true;
    } else if (hasThumb && input.prepareElapsedMs >= 20_000) {
      ready = true;
      openingWithoutFullTranscript = !hasTranscript;
    } else if (
      input.prepareElapsedMs >= 45_000 &&
      (hasThumb || hasTranscript)
    ) {
      ready = true;
      openingWithoutFullTranscript = !hasTranscript;
    }
  } else if (thumbsReady && transcriptReady) {
    ready = true;
  } else if (thumbsReady && transcriptGraceElapsed) {
    // Filmstrip is enough to edit; transcript continues in the background.
    ready = true;
    openingWithoutFullTranscript = true;
  }

  let statusMessage = "Preparing your timeline";
  let detailMessage = "Building filmstrip frames and transcript…";
  const hint = input.transcriptionHint?.trim();

  if (input.hasSourceError) {
    statusMessage = "Source not ready yet";
    detailMessage =
      "Waiting on local recording — you can continue shortly if it stays unavailable.";
  } else if (input.previouslyPrepared) {
    statusMessage = "Restoring editor";
    detailMessage = "Reloading filmstrip and transcript…";
  } else if (recorded < 2) {
    statusMessage = "Waiting for recording";
    detailMessage = "Downloading or buffering source media…";
  } else if (!thumbsReady && !transcriptReady) {
    statusMessage = "Building timeline";
    detailMessage = `Filmstrip ${Math.round(thumbRatio * 100)}% · Transcript ${Math.round(transcriptRatio * 100)}%`;
  } else if (!thumbsReady) {
    statusMessage = "Generating screenshots";
    detailMessage = `Filmstrip ${Math.round(thumbRatio * 100)}% ready (need ${Math.round(EDITOR_READY_RATIO * 100)}%)`;
  } else if (!transcriptReady) {
    statusMessage = hint?.toLowerCase().includes("audio")
      ? "Waiting for audio"
      : "Transcribing audio";
    detailMessage =
      hint ||
      (transcriptGraceElapsed
        ? "Filmstrip ready — opening editor; transcript continues in the background."
        : `Transcript ${Math.round(transcriptRatio * 100)}% ready (need ${Math.round(EDITOR_READY_RATIO * 100)}%)`);
  } else {
    statusMessage = "Opening editor";
    detailMessage = "Timeline is ready";
  }

  if (
    forcedByTimeout &&
    !(thumbsReady && transcriptReady)
  ) {
    statusMessage = "Opening with partial timeline";
    detailMessage = "Taking longer than usual — continuing with what's ready.";
  }

  return {
    ready,
    forcedByTimeout,
    transcriptRatio,
    thumbRatio,
    overallRatio,
    recordedSeconds: recorded,
    transcribedSeconds: transcribed,
    thumbCoveredSeconds,
    expectedThumbCount,
    thumbCount,
    statusMessage,
    detailMessage,
    openingWithoutFullTranscript,
  };
}
