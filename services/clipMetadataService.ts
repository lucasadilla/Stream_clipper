import { prisma } from "@/lib/db";
import { generateClipMetadataAI } from "@/lib/ai";
import { hasAnyAiKey } from "@/lib/aiProvider";
import { formatSeconds } from "@/lib/time";
import { isPlaceholderTranscript } from "@/services/transcriptionSyncService";
import { getTranscriptChunksForRange } from "@/services/transcriptService";

function buildClipTranscriptText(
  chunks: Array<{ startTimeSeconds: number; endTimeSeconds: number; text: string }>,
  startTimeSeconds: number,
  endTimeSeconds: number
): string {
  return chunks
    .filter((c) => !isPlaceholderTranscript(c.text))
    .map(
      (c) =>
        `[${formatSeconds(c.startTimeSeconds)}] ${c.text.trim()}`
    )
    .join("\n")
    .slice(0, 8000);
}

export async function generateClipMetadata(
  streamSessionId: string,
  startTimeSeconds: number,
  endTimeSeconds: number
) {
  if (!hasAnyAiKey()) {
    throw new Error("Set OPENROUTER_API_KEY or OPENAI_API_KEY in .env");
  }

  if (endTimeSeconds <= startTimeSeconds) {
    throw new Error("Invalid clip range");
  }

  const session = await prisma.streamSession.findUnique({
    where: { id: streamSessionId },
    select: { title: true, channelTitle: true },
  });
  if (!session) throw new Error("Session not found");

  const chunks = await getTranscriptChunksForRange(
    streamSessionId,
    startTimeSeconds,
    endTimeSeconds
  );

  const transcript = buildClipTranscriptText(
    chunks,
    startTimeSeconds,
    endTimeSeconds
  );
  if (!transcript.trim()) {
    throw new Error(
      "No transcript in this range yet — wait for transcription or widen the selection"
    );
  }

  return generateClipMetadataAI({
    streamTitle: session.title ?? undefined,
    channelTitle: session.channelTitle ?? undefined,
    transcript,
    startTimeSeconds,
    endTimeSeconds,
  });
}
