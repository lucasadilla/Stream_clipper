import { getChatModel, isOpenRouterEnabled } from "@/lib/aiProvider";
import {
  hookEngineModeSchema,
  type HookEngineMode,
} from "@/lib/hookIntelligence";

export type AiDecisionRole = "cheap" | "strong" | "teacher";

export interface AiModelRoute {
  role: AiDecisionRole;
  provider: "openrouter" | "openai";
  model: string;
  reasoningLevel: "none" | "low" | "medium" | "high";
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  fallbackModel: string | null;
  costCeilingUsd: number | null;
}

export interface HookEnginePolicy {
  version: "hook-policy-v1";
  mode: HookEngineMode;
  cheap: AiModelRoute;
  strong: AiModelRoute;
  teacher: AiModelRoute | null;
  seriousCandidateLimit: number;
  openingCandidatesPerMoment: number;
  abPercent: number;
  enableTemporalReordering: boolean;
}

function numberFromEnv(name: string, fallback: number, min: number, max: number) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed)
    ? Math.max(min, Math.min(max, parsed))
    : fallback;
}

function modelRoute(
  role: AiDecisionRole,
  model: string,
  defaults: {
    temperature: number;
    maxTokens: number;
    timeoutMs: number;
    costCeilingUsd: number | null;
  }
): AiModelRoute {
  const prefix = `HOOK_${role.toUpperCase()}`;
  const reasoning = process.env[`${prefix}_REASONING_LEVEL`]?.trim();
  return {
    role,
    provider: isOpenRouterEnabled() ? "openrouter" : "openai",
    model,
    reasoningLevel:
      reasoning === "none" ||
      reasoning === "low" ||
      reasoning === "medium" ||
      reasoning === "high"
        ? reasoning
        : role === "strong"
          ? "medium"
          : "low",
    temperature: numberFromEnv(
      `${prefix}_TEMPERATURE`,
      defaults.temperature,
      0,
      1.5
    ),
    maxTokens: Math.round(
      numberFromEnv(`${prefix}_MAX_TOKENS`, defaults.maxTokens, 256, 16_000)
    ),
    timeoutMs: Math.round(
      numberFromEnv(`${prefix}_TIMEOUT_MS`, defaults.timeoutMs, 5_000, 180_000)
    ),
    fallbackModel: process.env[`${prefix}_FALLBACK_MODEL`]?.trim() || null,
    costCeilingUsd: numberFromEnv(
      `${prefix}_COST_CEILING_USD`,
      defaults.costCeilingUsd ?? -1,
      -1,
      100
    ) < 0
      ? null
      : numberFromEnv(
          `${prefix}_COST_CEILING_USD`,
          defaults.costCeilingUsd ?? 0,
          0,
          100
        ),
  };
}

export function getHookEnginePolicy(): HookEnginePolicy {
  const configuredMode = process.env.HOOK_ENGINE_MODE?.trim().toLowerCase();
  const mode = hookEngineModeSchema.catch("shadow").parse(configuredMode);
  const defaultModel = getChatModel();
  const cheapModel =
    process.env.HOOK_CHEAP_MODEL?.trim() ||
    process.env.CLIP_RANKING_MODEL?.trim() ||
    defaultModel;
  const strongModel =
    process.env.HOOK_STRONG_MODEL?.trim() ||
    process.env.VISUAL_ANALYSIS_MODEL?.trim() ||
    defaultModel;
  const teacherModel = process.env.HOOK_TEACHER_MODEL?.trim();
  return {
    version: "hook-policy-v1",
    mode,
    cheap: modelRoute("cheap", cheapModel, {
      temperature: 0.15,
      maxTokens: 2_000,
      timeoutMs: 35_000,
      costCeilingUsd: 0.02,
    }),
    strong: modelRoute("strong", strongModel, {
      temperature: 0.2,
      maxTokens: 6_000,
      timeoutMs: 75_000,
      costCeilingUsd: 0.15,
    }),
    teacher: teacherModel
      ? modelRoute("teacher", teacherModel, {
          temperature: 0.1,
          maxTokens: 8_000,
          timeoutMs: 120_000,
          costCeilingUsd: 0.5,
        })
      : null,
    seriousCandidateLimit: Math.round(
      numberFromEnv("HOOK_SERIOUS_CANDIDATE_LIMIT", 8, 1, 20)
    ),
    openingCandidatesPerMoment: Math.round(
      numberFromEnv("HOOK_OPENING_CANDIDATE_LIMIT", 5, 2, 6)
    ),
    abPercent: numberFromEnv("HOOK_ENGINE_AB_PERCENT", 10, 0, 100),
    enableTemporalReordering:
      process.env.HOOK_ENABLE_TEMPORAL_REORDERING?.trim().toLowerCase() === "true",
  };
}

