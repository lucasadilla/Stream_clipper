import type { CaptionAnimation } from "@/lib/captionAppearance";
import type { CaptionCue } from "@/lib/captionTrack";

export const CAPTION_DIRECTOR_VERSION = 2 as const;

export const CAPTION_NARRATIVE_ROLES = [
  "hook",
  "setup",
  "build",
  "question",
  "turn",
  "reaction",
  "payoff",
  "cta",
] as const;

export type CaptionNarrativeRole = (typeof CAPTION_NARRATIVE_ROLES)[number];
export type CaptionIntensity = "subtle" | "standard" | "strong";
export type CaptionDirectorSource = "automatic" | "ai";

export interface CaptionCueDirection {
  role: CaptionNarrativeRole;
  intensity: CaptionIntensity;
  /** Reserved for backward compatibility; Clipper renders uniform word weight. */
  emphasisWordIndexes: number[];
  /** Stable, non-scaling motion chosen for this phrase. */
  animation: CaptionAnimation;
}

export interface CaptionDirectionPlan {
  version: typeof CAPTION_DIRECTOR_VERSION;
  fingerprint: string;
  generatedBy: CaptionDirectorSource;
  createdAt: string;
  cues: Record<string, CaptionCueDirection>;
}

const REACTION_WORDS = new Set([
  "amazing",
  "beautiful",
  "crazy",
  "exactly",
  "impossible",
  "insane",
  "nice",
  "nope",
  "seriously",
  "unbelievable",
  "wait",
  "what",
  "wow",
  "yes",
]);

const TURN_WORDS = new Set([
  "actually",
  "although",
  "but",
  "except",
  "however",
  "instead",
  "then",
  "until",
  "yet",
]);

const CTA_WORDS = new Set([
  "comment",
  "follow",
  "join",
  "like",
  "share",
  "subscribe",
  "try",
  "watch",
]);

function normalizedToken(token: string): string {
  return token
    .toLocaleLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}'’-]+$/gu, "")
    .trim();
}

/** Stable token order for timed browser caption rendering. */
export function captionCueTokens(cue: Pick<CaptionCue, "text" | "words">): string[] {
  if (cue.words && cue.words.length > 0) {
    return cue.words.map((word) => word.word.trim()).filter(Boolean);
  }
  return cue.text.replace(/\n/g, " ").split(/\s+/).filter(Boolean);
}

function cueRole(
  cue: CaptionCue,
  index: number,
  total: number
): CaptionNarrativeRole {
  const tokens = captionCueTokens(cue).map(normalizedToken).filter(Boolean);
  const text = cue.text.trim();

  if (index === 0) return "hook";
  if (index === total - 1) return "payoff";
  if (tokens.some((word) => CTA_WORDS.has(word)) && /\b(?:me|us|below|now|for more)\b/i.test(text)) {
    return "cta";
  }
  if (/\?\s*$/.test(text)) return "question";
  if (/!\s*$/.test(text) || tokens.some((word) => REACTION_WORDS.has(word))) {
    return "reaction";
  }
  if (tokens.some((word) => TURN_WORDS.has(word))) return "turn";
  return index <= Math.max(1, Math.floor(total * 0.3)) ? "setup" : "build";
}

function roleIntensity(role: CaptionNarrativeRole): CaptionIntensity {
  if (role === "hook" || role === "reaction" || role === "payoff") return "strong";
  if (role === "question" || role === "turn" || role === "cta") return "standard";
  return "subtle";
}

function roleAnimation(role: CaptionNarrativeRole): CaptionAnimation {
  return role === "setup" || role === "build" ? "fade" : "wordReveal";
}

/** Small browser-safe hash used to reject stale AI direction after caption edits. */
export function captionCueFingerprint(cues: CaptionCue[]): string {
  const source = cues
    .map(
      (cue) =>
        `${cue.id}|${cue.startTimeSeconds.toFixed(3)}|${cue.endTimeSeconds.toFixed(3)}|${cue.text}`
    )
    .join("\u241e");
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `caption-v${CAPTION_DIRECTOR_VERSION}-${(hash >>> 0).toString(36)}`;
}

export function buildAutomaticCaptionDirection(
  cues: CaptionCue[]
): CaptionDirectionPlan {
  const directions: Record<string, CaptionCueDirection> = {};
  cues.forEach((cue, index) => {
    const role = cueRole(cue, index, cues.length);
    directions[cue.id] = {
      role,
      intensity: roleIntensity(role),
      emphasisWordIndexes: [],
      animation: roleAnimation(role),
    };
  });

  return {
    version: CAPTION_DIRECTOR_VERSION,
    fingerprint: captionCueFingerprint(cues),
    generatedBy: "automatic",
    createdAt: new Date().toISOString(),
    cues: directions,
  };
}

export function isCaptionNarrativeRole(value: unknown): value is CaptionNarrativeRole {
  return CAPTION_NARRATIVE_ROLES.includes(value as CaptionNarrativeRole);
}

export function normalizeCaptionCueDirection(
  value: unknown,
  cue: CaptionCue,
  fallback?: CaptionCueDirection
): CaptionCueDirection | null {
  if (!value || typeof value !== "object") return fallback ?? null;
  const raw = value as Record<string, unknown>;
  const role = isCaptionNarrativeRole(raw.role) ? raw.role : fallback?.role;
  if (!role) return null;
  const intensity =
    raw.intensity === "subtle" ||
    raw.intensity === "standard" ||
    raw.intensity === "strong"
      ? raw.intensity
      : fallback?.intensity ?? roleIntensity(role);
  const animation =
    raw.animation === "none" ||
    raw.animation === "fade" ||
    raw.animation === "wordReveal" ||
    raw.animation === "rise" ||
    raw.animation === "focus"
      ? raw.animation
      : fallback?.animation ?? roleAnimation(role);

  return { role, intensity, emphasisWordIndexes: [], animation };
}

export function parseCaptionDirectionPlan(
  value: unknown,
  cues: CaptionCue[]
): CaptionDirectionPlan | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (
    raw.version !== CAPTION_DIRECTOR_VERSION ||
    raw.fingerprint !== captionCueFingerprint(cues) ||
    (raw.generatedBy !== "automatic" && raw.generatedBy !== "ai") ||
    !raw.cues ||
    typeof raw.cues !== "object" ||
    Array.isArray(raw.cues)
  ) {
    return null;
  }

  const automatic = buildAutomaticCaptionDirection(cues);
  const cueValues = raw.cues as Record<string, unknown>;
  const directions: Record<string, CaptionCueDirection> = {};
  for (const cue of cues) {
    const direction = normalizeCaptionCueDirection(
      cueValues[cue.id],
      cue,
      automatic.cues[cue.id]
    );
    if (direction) directions[cue.id] = direction;
  }

  return {
    version: CAPTION_DIRECTOR_VERSION,
    fingerprint: raw.fingerprint,
    generatedBy: raw.generatedBy,
    createdAt:
      typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString(),
    cues: directions,
  };
}

/** Attach a grounded plan, or a zero-latency automatic plan when none is valid. */
export function directCaptionTrack(
  cues: CaptionCue[],
  plan?: CaptionDirectionPlan | null
): CaptionCue[] {
  const validPlan = plan ? parseCaptionDirectionPlan(plan, cues) : null;
  const resolved = validPlan ?? buildAutomaticCaptionDirection(cues);
  return cues.map((cue) => ({
    ...cue,
    words: cue.words?.map((word) => ({ ...word })),
    direction: resolved.cues[cue.id],
  }));
}

export function effectiveCaptionAnimation(
  _cue: Pick<CaptionCue, "direction">,
  requested: CaptionAnimation
): CaptionAnimation {
  // The editor control is an explicit user choice. Narrative direction can
  // recommend a motion, but must never replace the animation the user picked.
  return requested;
}

export function captionDirectionLabel(direction?: CaptionCueDirection): string {
  if (!direction) return "Directed";
  return direction.role.charAt(0).toUpperCase() + direction.role.slice(1);
}
