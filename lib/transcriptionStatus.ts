export interface TranscriptionStatusPayload {
  error?: string;
  reason?: string;
}

export function isBackgroundTranscriptionStatus(
  data: TranscriptionStatusPayload
): boolean {
  return ["sync_in_progress", "no_file", "no_audio", "too_short", "audio_not_ready"].includes(
    data.reason ?? ""
  );
}

export function transcriptionStatusMessage(
  data: TranscriptionStatusPayload
): string | null {
  if (data.reason === "no_file") {
    return "Waiting for the source video to finish downloading…";
  }
  if (data.reason === "no_audio") {
    return "Waiting for audio — fetching the soundtrack…";
  }
  if (
    data.reason === "no_transcription_provider" ||
    data.reason === "no_openai_key"
  ) {
    return "Set DEEPGRAM_API_KEY, OPENROUTER_API_KEY, or OPENAI_API_KEY in .env";
  }
  if (data.reason === "too_short") {
    return "Waiting for enough audio to transcribe…";
  }
  if (data.reason === "audio_not_ready") {
    return "Buffering capture — transcription will resume shortly";
  }
  if (isBackgroundTranscriptionStatus(data)) {
    return "Transcription is running in the background…";
  }
  if (data.reason === "provider_unavailable") {
    const detail = data.error?.trim();
    return /quota/i.test(detail ?? "")
      ? "AI provider quota exceeded — add credits and transcription will resume"
      : detail
        ? `Transcription unavailable (${detail}) — retrying`
        : "AI provider unreachable — retrying";
  }
  if (data.error?.toLowerCase().includes("enough audio")) {
    return "Waiting for enough audio to transcribe…";
  }
  return data.error ?? null;
}
