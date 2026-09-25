import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { extractAudioSegment } from "@/lib/ffmpeg";
import { transcribeWhisperAudio, type WhisperTranscriptionOptions } from "@/services/whisperTranscription";
import type { TranscriptSegmentWithMeta } from "@/lib/transcriptionTypes";

/** Short overlapping windows keep fast speech and corrections near real anchors. */
export async function transcribeClipAccurately(input: {
  sourcePath: string;
  sourceStart: number;
  timelineStart: number;
  duration: number;
  tempDir: string;
  options: WhisperTranscriptionOptions;
}): Promise<TranscriptSegmentWithMeta[]> {
  const result: TranscriptSegmentWithMeta[] = [];
  await fs.mkdir(input.tempDir, { recursive: true });
  for (let offset = 0; offset < input.duration;) {
    // Fold a tiny final tail into the preceding window. Very short isolated
    // audio is less reliable and can turn a breath or sound effect into text.
    const coreEnd = input.duration - (offset + 18) < 6
      ? input.duration : offset + 18;
    const windowStart = Math.max(0, offset - 1.5);
    const windowEnd = Math.min(input.duration, coreEnd + 1.5);
    const audioPath = path.join(input.tempDir, `caption-refine-${randomUUID()}.wav`);
    try {
      await extractAudioSegment(input.sourcePath, audioPath,
        input.sourceStart + windowStart, windowEnd - windowStart, { accurateSeek: true });
      const segments = await transcribeWhisperAudio(audioPath,
        input.timelineStart + windowStart, input.options);
      for (const segment of segments) {
        const words = segment.words?.filter((word) => {
          const midpoint = (word.start + word.end) / 2 - input.timelineStart;
          return midpoint >= offset && midpoint < coreEnd;
        });
        if (words?.length) {
          result.push({ ...segment, words,
            startTimeSeconds: words[0]!.start,
            endTimeSeconds: Math.max(...words.map((word) => word.end)),
            text: words.map((word) => word.word.trim()).join(" "),
          });
        } else if (!segment.words?.length && segment.startTimeSeconds >= input.timelineStart + offset &&
          segment.startTimeSeconds < input.timelineStart + coreEnd) {
          result.push(segment);
        }
      }
    } finally {
      await fs.unlink(audioPath).catch(() => {});
    }
    offset = coreEnd;
  }
  return result.sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);
}
