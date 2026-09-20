import os from "os";
import path from "path";
import fs from "fs/promises";
import { getAiClient, getChatModel, hasAnyAiKey } from "@/lib/aiProvider";
import { normalizeEditorState, segmentDuration } from "@/lib/editorState";
import { extractSoloTimelineFrame, probeMedia } from "@/lib/ffmpeg";
import {
  buildCriticSampleTimes,
  buildTechnicalQualityReview,
  mergeAiQualityReview,
  parseAiCriticResponse,
  type PostRenderQualityReview,
} from "@/lib/postRenderCritic";
import { getTranscriptChunksForRange } from "@/services/transcriptService";
import { prisma } from "@/lib/db";

interface CriticRenderParams {
  streamSessionId: string;
  clipSuggestionId?: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  format?: "vertical" | "native";
  includeCaptions?: boolean;
  editorState?: unknown;
}

interface TimedTranscriptLine {
  outputStart: number;
  outputEnd: number;
  sourceStart: number;
  sourceEnd: number;
  text: string;
}

function criticEnabled(): boolean {
  if (process.env.NODE_ENV === "test") return false;
  return !/^(0|false|off|no)$/i.test(
    process.env.POST_RENDER_CRITIC_ENABLED?.trim() ?? "true"
  );
}

function expectedDuration(params: CriticRenderParams): number {
  const state = normalizeEditorState(params.editorState);
  if (state.segments.length > 0) {
    return state.segments.reduce((total, segment) => total + segmentDuration(segment), 0);
  }
  return Math.max(0, params.endTimeSeconds - params.startTimeSeconds);
}

function cutTimes(params: CriticRenderParams): number[] {
  const segments = normalizeEditorState(params.editorState).segments;
  let cursor = 0;
  return segments.slice(0, -1).map((segment) => {
    cursor += segmentDuration(segment);
    return cursor;
  });
}

function expectsAudio(params: CriticRenderParams): boolean {
  const segments = normalizeEditorState(params.editorState).segments;
  return segments.length === 0 || segments.some((segment) => !segment.muted);
}

async function buildTimedTranscript(
  params: CriticRenderParams
): Promise<TimedTranscriptLine[]> {
  const state = normalizeEditorState(params.editorState);
  const segments = state.segments;
  const sourceStart = segments.length
    ? Math.min(...segments.map((segment) => segment.sourceStart))
    : params.startTimeSeconds;
  const sourceEnd = segments.length
    ? Math.max(...segments.map((segment) => segment.sourceEnd))
    : params.endTimeSeconds;
  const chunks = await getTranscriptChunksForRange(
    params.streamSessionId,
    Math.max(0, sourceStart - 2),
    sourceEnd + 2
  );

  if (segments.length === 0) {
    return chunks
      .map((chunk) => ({
        outputStart: chunk.startTimeSeconds - params.startTimeSeconds,
        outputEnd: chunk.endTimeSeconds - params.startTimeSeconds,
        sourceStart: chunk.startTimeSeconds,
        sourceEnd: chunk.endTimeSeconds,
        text: chunk.text.trim(),
      }))
      .filter((line) => line.text && line.outputEnd >= -1 && line.outputStart <= sourceEnd - sourceStart + 1);
  }

  const lines: TimedTranscriptLine[] = [];
  let outputOffset = 0;
  for (const segment of segments) {
    for (const chunk of chunks) {
      const overlapStart = Math.max(segment.sourceStart, chunk.startTimeSeconds);
      const overlapEnd = Math.min(segment.sourceEnd, chunk.endTimeSeconds);
      if (overlapEnd <= overlapStart || !chunk.text.trim()) continue;
      lines.push({
        outputStart: outputOffset + overlapStart - segment.sourceStart,
        outputEnd: outputOffset + overlapEnd - segment.sourceStart,
        sourceStart: overlapStart,
        sourceEnd: overlapEnd,
        text: chunk.text.trim(),
      });
    }
    outputOffset += segmentDuration(segment);
  }
  return lines;
}

function transcriptForPrompt(lines: TimedTranscriptLine[]): string {
  const formatted = lines.map(
    (line) =>
      `[${line.outputStart.toFixed(2)}-${line.outputEnd.toFixed(2)}s] ${line.text}`
  );
  const joined = formatted.join("\n");
  if (joined.length <= 9_000) return joined || "No transcript was available.";
  return `${joined.slice(0, 4_300)}\n[...middle omitted...]\n${joined.slice(-4_300)}`;
}

function expectedWordsAt(
  lines: TimedTranscriptLine[],
  timeSeconds: number
): string {
  const matches = lines.filter(
    (line) => line.outputStart <= timeSeconds + 0.35 && line.outputEnd >= timeSeconds - 0.35
  );
  return matches.map((line) => line.text).join(" ").slice(0, 260) || "No timed transcript at this frame";
}

async function extractReviewFrames(
  outputPath: string,
  sampleTimes: number[]
): Promise<Array<{ timeSeconds: number; dataUrl: string }>> {
  if (sampleTimes.length === 0) return [];
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipper-critic-"));
  try {
    const frames: Array<{ timeSeconds: number; dataUrl: string }> = [];
    // Keep extraction serial: two simultaneous 1080p decoders can spike Railway RAM.
    for (let index = 0; index < sampleTimes.length; index += 1) {
      const output = path.join(tempDir, `sample-${String(index).padStart(2, "0")}.jpg`);
      try {
        await extractSoloTimelineFrame(outputPath, output, sampleTimes[index]!, 420, 6);
        const bytes = await fs.readFile(output);
        frames.push({
          timeSeconds: sampleTimes[index]!,
          dataUrl: `data:image/jpeg;base64,${bytes.toString("base64")}`,
        });
      } catch (error) {
        console.warn(
          `[render-critic] could not extract frame ${index + 1}:`,
          error instanceof Error ? error.message : error
        );
      }
    }
    return frames;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

function criticPrompt(input: {
  title: string;
  reason: string;
  streamTitle: string;
  channelTitle: string;
  durationSeconds: number;
  width: number;
  height: number;
  includeCaptions: boolean;
  cuts: number[];
  transcript: TimedTranscriptLine[];
  frames: Array<{ timeSeconds: number; dataUrl: string }>;
}): string {
  const frameGuide = input.frames
    .map(
      (frame, index) =>
        `FRAME ${index + 1}: output ${frame.timeSeconds.toFixed(2)}s; expected speech: ${expectedWordsAt(
          input.transcript,
          frame.timeSeconds
        )}`
    )
    .join("\n");

  return `You are Clipper's final export quality critic. Audit the ACTUAL rendered frames like a meticulous senior short-form video editor. Be strict, specific, and evidence-grounded.

You can evaluate:
- whether the important speaker/subject is framed cleanly and consistently
- black/blank/corrupt frames, awkward crops, cut-off faces, and excessive empty space
- caption presence, legibility, safe-zone placement, clipping, obvious wrong words, or literal ellipses replacing speech
- visible discontinuities around supplied edit boundaries
- whether the transcript opens with context and ends on a complete thought
- whether this export looks publishable as a polished social clip

Important limits:
- These are still frames, so do NOT claim audio drift, lip-sync problems, jumpiness, or motion defects you cannot prove.
- A stylized karaoke caption may show only the current phrase; do not flag it merely for not showing the full transcript line.
- Do not invent a problem. Every visual issue with a timestamp must reference one supplied frame timestamp.
- If captions are disabled, score captions 100 and do not report missing captions.
- A cut issue may use an exact supplied cut time or the beginning/end of the transcript.
- Use "critical" only when the export is clearly unsafe to publish. Use "warning" for polish improvements.
- Issue category must be exactly one of: framing, captions, cuts, clarity, platform, audio.
- Do not report an audio issue from still frames. Audio presence is checked separately.

Return JSON only:
{
  "summary": "one decisive sentence",
  "scores": {
    "framing": 0,
    "captions": 0,
    "cuts": 0,
    "clarity": 0,
    "platformReadiness": 0
  },
  "issues": [{
    "severity": "warning",
    "category": "framing",
    "timestampSeconds": 1.25,
    "title": "short issue title",
    "evidence": "what is visibly or textually wrong",
    "recommendation": "specific edit to make"
  }],
  "strengths": ["specific thing that worked"]
}

EXPORT
Clip title: ${input.title || "Untitled clip"}
Selection reason: ${input.reason || "Not provided"}
Source stream: ${input.streamTitle || "Unknown"}
Creator/channel: ${input.channelTitle || "Unknown"}
Duration: ${input.durationSeconds.toFixed(2)}s
Dimensions: ${input.width}x${input.height}
Captions expected: ${input.includeCaptions ? "yes" : "no"}
Edit boundaries: ${input.cuts.length ? input.cuts.map((time) => `${time.toFixed(2)}s`).join(", ") : "single continuous range"}

FRAME GUIDE (images follow in this exact order)
${frameGuide || "No frames were available."}

EDITED TRANSCRIPT
${transcriptForPrompt(input.transcript)}`;
}

export async function reviewRenderedOutput(input: {
  outputPath: string;
  params: CriticRenderParams;
}): Promise<PostRenderQualityReview> {
  const [probe, stat, context, transcript] = await Promise.all([
    probeMedia(input.outputPath),
    fs.stat(input.outputPath),
    prisma.streamSession.findUnique({
      where: { id: input.params.streamSessionId },
      select: {
        title: true,
        channelTitle: true,
        clipSuggestions: input.params.clipSuggestionId
          ? {
              where: { id: input.params.clipSuggestionId },
              select: { title: true, reason: true },
              take: 1,
            }
          : false,
      },
    }),
    buildTimedTranscript(input.params).catch(() => []),
  ]);
  const duration = probe.durationSeconds || expectedDuration(input.params);
  const technical = buildTechnicalQualityReview({
    durationSeconds: probe.durationSeconds,
    expectedDurationSeconds: expectedDuration(input.params),
    width: probe.width,
    height: probe.height,
    fps: probe.fps,
    videoCodec: probe.videoCodec,
    audioCodec: probe.audioCodec,
    fileSizeBytes: stat.size,
    format: input.params.format ?? "vertical",
    expectsAudio: expectsAudio(input.params),
    expectsCaptions: input.params.includeCaptions !== false,
  });

  if (!criticEnabled() || !hasAnyAiKey()) {
    return {
      ...technical,
      summary: hasAnyAiKey()
        ? "The export passed through technical checks; visual AI review is disabled."
        : "The export passed through technical checks; visual AI review needs an AI provider key.",
    };
  }

  const boundaries = cutTimes(input.params);
  const sampleTimes = buildCriticSampleTimes(duration, boundaries, 6);
  const frames = await extractReviewFrames(input.outputPath, sampleTimes);
  if (frames.length === 0) {
    return {
      ...technical,
      verdict: technical.verdict === "fail" ? "fail" : "review",
      summary: "Technical checks completed, but the visual review frames could not be decoded.",
    };
  }

  const model = process.env.POST_RENDER_CRITIC_MODEL?.trim() || getChatModel();
  try {
    const prompt = criticPrompt({
      title: context?.clipSuggestions?.[0]?.title ?? "",
      reason: context?.clipSuggestions?.[0]?.reason ?? "",
      streamTitle: context?.title ?? "",
      channelTitle: context?.channelTitle ?? "",
      durationSeconds: duration,
      width: probe.width,
      height: probe.height,
      includeCaptions: input.params.includeCaptions !== false,
      cuts: boundaries,
      transcript,
      frames,
    });
    const content: Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string; detail: "low" } }
    > = [{ type: "text", text: prompt }];
    for (const frame of frames) {
      content.push({
        type: "image_url",
        image_url: { url: frame.dataUrl, detail: "low" },
      });
    }

    const response = await getAiClient().chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content:
            "You are a skeptical post-production QC editor. Never invent defects and never praise work you cannot verify.",
        },
        { role: "user", content },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_tokens: 1800,
    }, {
      timeout: 45_000,
      maxRetries: 1,
    });
    const raw = response.choices[0]?.message?.content;
    const parsed = raw ? parseAiCriticResponse(JSON.parse(raw)) : null;
    if (!parsed) throw new Error("AI critic returned an invalid review");
    return mergeAiQualityReview(technical, parsed, {
      model,
      samplesReviewed: frames.length,
      durationSeconds: duration,
      sampleTimes: frames.map((frame) => frame.timeSeconds),
    });
  } catch (error) {
    console.warn(
      "[render-critic] visual review unavailable:",
      error instanceof Error ? error.message : error
    );
    return {
      ...technical,
      summary: "The export passed through technical checks; the visual AI review was unavailable.",
    };
  }
}
