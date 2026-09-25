import { getTranscriptionLanguage } from "@/lib/aiProvider";
import type {
  TranscriptSegmentWithMeta,
  TranscriptionContextPacket,
} from "@/lib/transcriptionTypes";
import {
  isDeepgramConfigured,
  transcribeDeepgramAudio,
} from "@/services/deepgramTranscription";
import {
  isWhisperAvailable,
  transcribeWhisperAudio,
} from "@/services/whisperTranscription";

export type TranscriptionWorkload = "live" | "vod";

function providerPreference(
  workload: TranscriptionWorkload
): "auto" | "deepgram" | "whisper" {
  const value = (
    workload === "live"
      ? process.env.TRANSCRIPTION_LIVE_PROVIDER
      : process.env.TRANSCRIPTION_VOD_PROVIDER
  )
    ?.trim()
    .toLowerCase();
  if (value === "deepgram" || value === "whisper") return value;
  return "auto";
}

export function isTranscriptionAvailable(): boolean {
  return isDeepgramConfigured() || isWhisperAvailable();
}

export function configuredTranscriptionProviders(): string[] {
  return [
    ...(isDeepgramConfigured() ? ["deepgram"] : []),
    ...(isWhisperAvailable() ? ["whisper"] : []),
  ];
}

export function shouldUseDeepgramForWorkload(
  workload: TranscriptionWorkload
): boolean {
  return (
    isDeepgramConfigured() &&
    providerPreference(workload) !== "whisper"
  );
}

export async function transcribeAudioWithRouter(
  audioPath: string,
  timeOffsetSeconds: number,
  options: {
    workload: TranscriptionWorkload;
    context?: TranscriptionContextPacket;
  }
): Promise<TranscriptSegmentWithMeta[]> {
  const context: TranscriptionContextPacket = {
    keyterms: options.context?.keyterms ?? [],
    prompt: options.context?.prompt,
    language: options.context?.language ?? getTranscriptionLanguage(),
  };
  const preference = providerPreference(options.workload);
  const useDeepgram = shouldUseDeepgramForWorkload(options.workload);

  if (useDeepgram) {
    try {
      return await transcribeDeepgramAudio(audioPath, timeOffsetSeconds, context);
    } catch (error) {
      if (!isWhisperAvailable() || preference === "deepgram") throw error;
      console.warn(
        "[transcribe] Deepgram unavailable; falling back to Whisper:",
        error instanceof Error ? error.message : error
      );
    }
  }

  if (isWhisperAvailable()) {
    return transcribeWhisperAudio(audioPath, timeOffsetSeconds, {
      prompt: context.prompt,
      language: context.language,
      keyterms: context.keyterms,
    });
  }

  return transcribeDeepgramAudio(audioPath, timeOffsetSeconds, context);
}
