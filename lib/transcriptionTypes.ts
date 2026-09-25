export interface TranscriptWord {
  start: number;
  end: number;
  word: string;
  confidence?: number;
  /** Provider-local diarization label. Never treat this as source-global. */
  speaker?: string;
  /** Stable source-level identity resolved by SpeakerContextService. */
  speakerId?: string;
  speakerConfidence?: number;
  overlappingSpeakerIds?: string[];
  alignmentConfidence?: number;
  speakerAssignmentSource?: "provider" | "word_alignment" | "creator_override";
}

export interface TranscriptSegment {
  startTimeSeconds: number;
  endTimeSeconds: number;
  text: string;
}

export interface TranscriptSegmentWithMeta extends TranscriptSegment {
  estimatedTiming?: boolean;
  words?: TranscriptWord[];
  provider?: "openai" | "openrouter" | "deepgram";
  model?: string;
  timingModel?: string;
  diarizationModel?: string;
  confidence?: number;
  rawText?: string;
}

export interface TranscriptionContextPacket {
  prompt?: string;
  keyterms: string[];
  language?: string;
}
