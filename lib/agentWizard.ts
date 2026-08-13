import type { ContentLookPresetId } from "@/lib/contentLookPresets";

export type AgentWizardStep =
  | "transcribing"
  | "pick"
  | "look"
  | "edit"
  | "export"
  | "done";

/** How Agent decides when to propose clips. */
export type AgentCadence = "vod_batch" | "live_now" | "after_stream";

export const AGENT_CADENCES = [
  "vod_batch",
  "live_now",
  "after_stream",
] as const;

/** Seconds of new transcript before another live_now suggest wave. */
export const LIVE_NOW_ROLL_SECONDS = 60;

/** Re-read a little prior context so moments crossing a wave boundary are complete. */
export const LIVE_NOW_CONTEXT_OVERLAP_SECONDS = 30;

/** Soft cap on non-rejected suggestions during live_now. */
export const LIVE_NOW_SUGGESTION_CAP = 100;

export function liveSuggestionWindow(
  lastSuggestThroughSeconds: number,
  throughSeconds: number
): { fromSeconds: number; throughSeconds: number } {
  return {
    fromSeconds: Math.max(
      0,
      lastSuggestThroughSeconds - LIVE_NOW_CONTEXT_OVERLAP_SECONDS
    ),
    throughSeconds: Math.max(0, throughSeconds),
  };
}

export interface AgentWizardState {
  step: AgentWizardStep;
  /** Clips the user selected from the top-10 grid (edit queue order). */
  selectedClipIds: string[];
  /** Index into selectedClipIds for look/edit/export. */
  queueIndex: number;
  lookPreset: ContentLookPresetId | null;
  faceAnalysisJobId: string | null;
  includeCaptions: boolean;
  dynamicPunchInEnabled: boolean;
  /** True once auto-suggest has been attempted for this session. */
  suggestRequested: boolean;
  /** VOD batch, rolling live, or wait-until-ended. Null until chosen/auto-set. */
  cadence: AgentCadence | null;
  /** Transcript frontier (seconds) at last suggest — used for live_now rolling. */
  lastSuggestThroughSeconds: number;
}

export const DEFAULT_AGENT_WIZARD_STATE: AgentWizardState = {
  step: "transcribing",
  selectedClipIds: [],
  queueIndex: 0,
  lookPreset: null,
  faceAnalysisJobId: null,
  includeCaptions: true,
  dynamicPunchInEnabled: true,
  suggestRequested: false,
  cadence: null,
  lastSuggestThroughSeconds: 0,
};

export function isAgentCadence(value: unknown): value is AgentCadence {
  return (
    typeof value === "string" &&
    (AGENT_CADENCES as readonly string[]).includes(value)
  );
}

export function readAgentWizardState(metadataJson: unknown): AgentWizardState {
  if (!metadataJson || typeof metadataJson !== "object") {
    return { ...DEFAULT_AGENT_WIZARD_STATE };
  }
  const raw = (metadataJson as { agentWizard?: Partial<AgentWizardState> })
    .agentWizard;
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_AGENT_WIZARD_STATE };
  }

  const step = isWizardStep(raw.step) ? raw.step : "transcribing";
  const selectedClipIds = Array.isArray(raw.selectedClipIds)
    ? raw.selectedClipIds.filter((id): id is string => typeof id === "string")
    : [];
  const queueIndex =
    typeof raw.queueIndex === "number" && Number.isFinite(raw.queueIndex)
      ? Math.max(0, Math.floor(raw.queueIndex))
      : 0;
  const lastSuggestThroughSeconds =
    typeof raw.lastSuggestThroughSeconds === "number" &&
    Number.isFinite(raw.lastSuggestThroughSeconds)
      ? Math.max(0, raw.lastSuggestThroughSeconds)
      : 0;

  return {
    step,
    selectedClipIds,
    queueIndex: Math.min(queueIndex, Math.max(0, selectedClipIds.length - 1)),
    lookPreset:
      typeof raw.lookPreset === "string"
        ? (raw.lookPreset as ContentLookPresetId)
        : null,
    faceAnalysisJobId:
      typeof raw.faceAnalysisJobId === "string" ? raw.faceAnalysisJobId : null,
    includeCaptions: raw.includeCaptions !== false,
    dynamicPunchInEnabled: raw.dynamicPunchInEnabled !== false,
    suggestRequested: Boolean(raw.suggestRequested),
    cadence: isAgentCadence(raw.cadence) ? raw.cadence : null,
    lastSuggestThroughSeconds,
  };
}

function isWizardStep(value: unknown): value is AgentWizardStep {
  return (
    value === "transcribing" ||
    value === "pick" ||
    value === "look" ||
    value === "edit" ||
    value === "export" ||
    value === "done"
  );
}

export function withAgentWizardState(
  metadataJson: unknown,
  wizard: AgentWizardState
): Record<string, unknown> {
  const base =
    metadataJson && typeof metadataJson === "object"
      ? { ...(metadataJson as Record<string, unknown>) }
      : {};
  return { ...base, agentWizard: wizard };
}
