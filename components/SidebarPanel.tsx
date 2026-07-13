"use client";

import { TranscriptChat } from "@/components/TranscriptChat";

interface SidebarPanelProps {
  sessionId: string;
  onSeek?: (seconds: number) => void;
  transcribedSeconds?: number;
  recordedSeconds?: number;
  transcribingActive?: boolean;
  transcriptionError?: string | null;
}

export function SidebarPanel({
  sessionId,
  onSeek,
  transcribedSeconds,
  recordedSeconds,
  transcribingActive,
  transcriptionError,
}: SidebarPanelProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <TranscriptChat
        sessionId={sessionId}
        onSeek={onSeek}
        transcribedSeconds={transcribedSeconds}
        recordedSeconds={recordedSeconds}
        transcribingActive={transcribingActive}
        transcriptionError={transcriptionError}
      />
    </div>
  );
}
