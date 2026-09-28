import { describe, expect, it } from "vitest";
import {
  isBackgroundTranscriptionStatus,
  transcriptionStatusMessage,
} from "@/lib/transcriptionStatus";
import { isProviderUnavailableError } from "@/services/whisperTranscription";
import { canPreemptTranscriptionLock } from "@/services/transcriptionLockService";

describe("transcription stall recovery", () => {
  it("treats an existing background sync as progress instead of a blocking error", () => {
    const status = { skipped: true, reason: "sync_in_progress" };
    expect(isBackgroundTranscriptionStatus(status)).toBe(true);
    expect(transcriptionStatusMessage(status)).toBe(
      "Transcription is running in the background…"
    );
  });

  it("keeps source and companion-audio preparation in the background state", () => {
    for (const reason of ["no_file", "no_audio", "too_short", "audio_not_ready"]) {
      expect(isBackgroundTranscriptionStatus({ reason })).toBe(true);
    }
    expect(transcriptionStatusMessage({ reason: "no_audio" })).toBe(
      "Waiting for audio — fetching the soundtrack…"
    );
  });

  it("recognizes provider timeouts as retryable availability failures", () => {
    expect(isProviderUnavailableError(new Error("TimeoutError: request timed out"))).toBe(true);
    expect(isProviderUnavailableError(new Error("The operation was aborted"))).toBe(true);
  });

  it("lets an interactive session recover a background-worker lock", () => {
    const now = new Date("2026-09-27T19:20:00.000Z");
    expect(
      canPreemptTranscriptionLock({
        requester: "api-123-session-request",
        holder: "worker-100-remote",
        lockedAt: new Date(now.getTime() - 20_000),
        now,
      })
    ).toBe(true);
    expect(
      canPreemptTranscriptionLock({
        requester: "worker-200-local",
        holder: "worker-100-remote",
        lockedAt: new Date(now.getTime() - 20_000),
        now,
      })
    ).toBe(false);
  });
});
