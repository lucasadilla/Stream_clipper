export interface TranscriptWord {
  start: number;
  end: number;
  word: string;
  confidence?: number;
  speaker?: string;
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
  confidence?: number;
  rawText?: string;
}

export interface TranscriptionContextPacket {
  prompt?: string;
  keyterms: string[];
  language?: string;
}
