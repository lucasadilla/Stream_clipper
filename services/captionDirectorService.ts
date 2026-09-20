import { z } from "zod";
import { prisma } from "@/lib/db";
import { getAiClient, getChatModel, hasAnyAiKey } from "@/lib/aiProvider";
import { buildCaptionTrack, type CaptionCue } from "@/lib/captionTrack";
import { applyCaptionEdits } from "@/lib/captionEdits";
import {
  CAPTION_NARRATIVE_ROLES,
  buildAutomaticCaptionDirection,
  normalizeCaptionCueDirection,
  parseCaptionDirectionPlan,
  type CaptionDirectionPlan,
} from "@/lib/captionDirector";
import { toJsonValue } from "@/lib/utils";
import { readCaptionEdits } from "@/services/captionEditService";
import { getTranscriptChunksForRange } from "@/services/transcriptService";

const aiRoleSchema = z.preprocess((value) => {
  if (value === "context") return "setup";
  if (value === "development" || value === "escalation") return "build";
  if (value === "resolution" || value === "ending") return "payoff";
  return value;
}, z.enum(CAPTION_NARRATIVE_ROLES));

const aiIntensitySchema = z.preprocess((value) => {
  if (value === "normal" || value === "medium" || value == null) {
    return "standard";
  }
  if (value === "low") return "subtle";
  if (value === "high") return "strong";
  return value;
}, z.enum(["subtle", "standard", "strong"]));

const aiCueSchema = z.object({
  cueId: z.string().min(1).max(180),
  role: aiRoleSchema,
  intensity: aiIntensitySchema,
});

const aiResponseSchema = z.object({
  cues: z.array(aiCueSchema).max(80),
});

function aiDirectorEnabled(): boolean {
  if (process.env.NODE_ENV === "test") return false;
  return !/^(0|false|off|no)$/i.test(
    process.env.CAPTION_DIRECTOR_AI_ENABLED?.trim() ?? "true"
  );
}

async function captionCuesForClip(input: {
  streamSessionId: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
}): Promise<CaptionCue[]> {
  const [chunks, edits] = await Promise.all([
    getTranscriptChunksForRange(
      input.streamSessionId,
      input.startTimeSeconds,
      input.endTimeSeconds
    ),
    readCaptionEdits(input.streamSessionId),
  ]);
  return applyCaptionEdits(
    buildCaptionTrack(
      chunks.map((chunk) => ({
        id: chunk.id,
        startTimeSeconds: chunk.startTimeSeconds,
        endTimeSeconds: chunk.endTimeSeconds,
        text: chunk.text,
        rawJson: chunk.rawJson,
      })),
      "vertical"
    ),
    edits
  ).filter(
    (cue) =>
      cue.endTimeSeconds > input.startTimeSeconds &&
      cue.startTimeSeconds < input.endTimeSeconds
  );
}

function roleAnimation(role: z.infer<typeof aiCueSchema>["role"]) {
  return role === "setup" || role === "build" ? "fade" : "wordReveal";
}

function promptForDirection(input: {
  title: string;
  reason: string;
  streamTitle: string;
  cues: CaptionCue[];
}): string {
  const cueBlock = input.cues
    .map(
      (cue) =>
        `[${cue.id}] ${cue.startTimeSeconds.toFixed(2)}-${cue.endTimeSeconds.toFixed(2)}\nTEXT: ${cue.text.replace(/\n/g, " ")}`
    )
    .join("\n\n");

  return `CLIP TITLE: ${input.title}
WHY THIS MOMENT WAS SELECTED: ${input.reason}
STREAM TITLE: ${input.streamTitle}

Direct the supplied captions like a senior short-form editor.

Rules:
- Return one decision for every cue ID, in the same order.
- Never rewrite, correct, add, remove, or paraphrase transcript words.
- Keep every word visually consistent. Do not select or enlarge individual words.
- Use hook only for the opening attention beat and payoff for the resolved final beat.
- setup gives essential context; build advances the thought; turn changes its direction;
  question asks something; reaction is an authentic emotional response; cta asks the viewer to act.
- Strong intensity is rare: reserve it for the hook, true reaction, or payoff.
- Preserve a calm editorial rhythm. Do not mark every phrase as reaction or strong.
- Metadata provides context only. The caption text is the sole source of truth.

Return JSON only:
{"cues":[{"cueId":"exact-id","role":"hook","intensity":"strong"}]}

CAPTIONS:
${cueBlock}`;
}

async function buildAiDirection(input: {
  title: string;
  reason: string;
  streamTitle: string;
  cues: CaptionCue[];
}): Promise<CaptionDirectionPlan | null> {
  if (!aiDirectorEnabled() || !hasAnyAiKey() || input.cues.length === 0) {
    return null;
  }
  const automatic = buildAutomaticCaptionDirection(input.cues);
  const response = await getAiClient().chat.completions.create(
    {
      model: process.env.CAPTION_DIRECTOR_MODEL?.trim() || getChatModel(),
      messages: [
        {
          role: "system",
          content:
            "You are Clipper's professional caption director. Editorial restraint and transcript fidelity outrank visual noise.",
        },
        { role: "user", content: promptForDirection(input) },
      ],
      response_format: { type: "json_object" },
      temperature: 0.15,
      max_tokens: 2400,
    },
    { timeout: 18_000, maxRetries: 1 }
  );
  const raw = response.choices[0]?.message?.content;
  if (!raw) return null;
  const parsed = aiResponseSchema.parse(JSON.parse(raw));
  const byId = new Map(parsed.cues.map((cue) => [cue.cueId, cue]));
  const directions = Object.fromEntries(
    input.cues.map((cue) => {
      const aiCue = byId.get(cue.id);
      const fallback = automatic.cues[cue.id]!;
      const direction = aiCue
        ? normalizeCaptionCueDirection(
            {
              ...aiCue,
              animation: roleAnimation(aiCue.role),
            },
            cue,
            fallback
          )
        : fallback;
      return [cue.id, direction ?? fallback];
    })
  );

  return {
    ...automatic,
    generatedBy: "ai",
    createdAt: new Date().toISOString(),
    cues: directions,
  };
}

export async function getCaptionDirectionForClip(
  clipSuggestionId: string,
  options: { force?: boolean } = {}
): Promise<{ plan: CaptionDirectionPlan; cues: CaptionCue[] }> {
  const clip = await prisma.clipSuggestion.findUnique({
    where: { id: clipSuggestionId },
    select: {
      id: true,
      title: true,
      reason: true,
      startTimeSeconds: true,
      endTimeSeconds: true,
      streamSessionId: true,
      captionDirection: true,
      streamSession: { select: { title: true } },
    },
  });
  if (!clip) throw new Error("Clip not found");

  const cues = await captionCuesForClip(clip);
  const automatic = buildAutomaticCaptionDirection(cues);
  const cached = options.force
    ? null
    : parseCaptionDirectionPlan(clip.captionDirection, cues);
  if (cached && (cached.generatedBy === "ai" || !hasAnyAiKey())) {
    return { plan: cached, cues };
  }

  let plan = automatic;
  try {
    plan =
      (await buildAiDirection({
        title: clip.title,
        reason: clip.reason,
        streamTitle: clip.streamSession.title ?? "",
        cues,
      })) ?? automatic;
  } catch (error) {
    console.warn(
      "[caption-director] AI direction unavailable; using automatic direction:",
      error instanceof z.ZodError
        ? `${error.errors.length} invalid direction field(s)`
        : error instanceof Error
          ? error.message
          : error
    );
  }

  await prisma.clipSuggestion
    .update({
      where: { id: clip.id },
      data: { captionDirection: toJsonValue(plan) },
    })
    .catch((error) => {
      console.warn(
        "[caption-director] could not cache direction:",
        error instanceof Error ? error.message : error
      );
    });
  return { plan, cues };
}

/** Read-only lookup for render/autopilot; never puts an AI call on the render path. */
export async function getCachedCaptionDirectionForClip(
  clipSuggestionId: string,
  cues: CaptionCue[]
): Promise<CaptionDirectionPlan | null> {
  const clip = await prisma.clipSuggestion.findUnique({
    where: { id: clipSuggestionId },
    select: { captionDirection: true },
  });
  return parseCaptionDirectionPlan(clip?.captionDirection, cues);
}

/** Warm AI direction beside thumbnails and face tracking without blocking picks. */
export async function prepareCaptionDirections(
  clipSuggestionIds: string[]
): Promise<void> {
  for (const id of clipSuggestionIds.slice(0, 6)) {
    await getCaptionDirectionForClip(id).catch(() => null);
  }
}
