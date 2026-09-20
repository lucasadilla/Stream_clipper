import type { ClipContentType } from "@/lib/clipContentProfile";

export type VisualAnalysisLevel =
  | "cached"
  | "local_only"
  | "screenshots"
  | "screenshots_then_video";

export interface VisualAnalysisBudgetPolicy {
  streamBudgetUsd: number;
  maximumCandidates: number;
  screenshotCandidateCostUsd: number;
  videoEscalationCostUsd: number;
  minimumCandidateScore: number;
  strongCandidateScore: number;
  screenshotCount: number;
  maximumScreenshotCount: number;
  maximumVideoSeconds: number;
}

export interface VisualAnalysisSignals {
  candidateScore: number;
  contentType: ClipContentType;
  cached: boolean;
  hasPaidProvider: boolean;
  hasTranscriptEvidence: boolean;
  localVisualScore: number;
  audioScore: number;
  chatScore: number;
  fastAction: boolean;
  ambiguity: number;
}

export interface VisualAnalysisDecision {
  level: VisualAnalysisLevel;
  maximumFrames: number;
  maximumVideoSeconds: number;
  estimatedCostUsd: number;
  reason: string;
}

export const DEFAULT_VISUAL_ANALYSIS_BUDGET: VisualAnalysisBudgetPolicy = {
  streamBudgetUsd: 0.2,
  maximumCandidates: 10,
  screenshotCandidateCostUsd: 0.008,
  videoEscalationCostUsd: 0.035,
  minimumCandidateScore: 32,
  strongCandidateScore: 68,
  screenshotCount: 8,
  maximumScreenshotCount: 12,
  maximumVideoSeconds: 60,
};

function finiteEnv(name: string, fallback: number): number {
  const value = Number.parseFloat(process.env[name]?.trim() ?? "");
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function visualAnalysisBudgetPolicyFromEnv(): VisualAnalysisBudgetPolicy {
  const defaults = DEFAULT_VISUAL_ANALYSIS_BUDGET;
  return {
    streamBudgetUsd: finiteEnv(
      "VISUAL_ANALYSIS_STREAM_BUDGET_USD",
      defaults.streamBudgetUsd
    ),
    maximumCandidates: Math.max(
      0,
      Math.round(
        finiteEnv(
          "VISUAL_ANALYSIS_MAX_CANDIDATES",
          defaults.maximumCandidates
        )
      )
    ),
    screenshotCandidateCostUsd: finiteEnv(
      "VISUAL_ANALYSIS_SCREENSHOT_COST_USD",
      defaults.screenshotCandidateCostUsd
    ),
    videoEscalationCostUsd: finiteEnv(
      "VISUAL_ANALYSIS_VIDEO_COST_USD",
      defaults.videoEscalationCostUsd
    ),
    minimumCandidateScore: finiteEnv(
      "VISUAL_ANALYSIS_MIN_CANDIDATE_SCORE",
      defaults.minimumCandidateScore
    ),
    strongCandidateScore: finiteEnv(
      "VISUAL_ANALYSIS_STRONG_CANDIDATE_SCORE",
      defaults.strongCandidateScore
    ),
    screenshotCount: Math.max(
      1,
      Math.round(
        finiteEnv("VISUAL_ANALYSIS_SCREENSHOT_COUNT", defaults.screenshotCount)
      )
    ),
    maximumScreenshotCount: Math.max(
      1,
      Math.round(
        finiteEnv(
          "VISUAL_ANALYSIS_MAX_SCREENSHOTS",
          defaults.maximumScreenshotCount
        )
      )
    ),
    maximumVideoSeconds: Math.max(
      5,
      finiteEnv(
        "VISUAL_ANALYSIS_MAX_VIDEO_SECONDS",
        defaults.maximumVideoSeconds
      )
    ),
  };
}

/**
 * Per-run budget controller. It keeps paid inference bounded while allowing
 * strong, visually ambiguous candidates to request one short video pass.
 */
export class VisualAnalysisBudgetService {
  private spentUsd = 0;
  private analyzedCandidates = 0;

  constructor(
    readonly policy: VisualAnalysisBudgetPolicy =
      visualAnalysisBudgetPolicyFromEnv(),
    initialUsage?: { spentUsd?: number; analyzedCandidates?: number }
  ) {
    this.spentUsd = Math.max(0, initialUsage?.spentUsd ?? 0);
    this.analyzedCandidates = Math.max(
      0,
      Math.round(initialUsage?.analyzedCandidates ?? 0)
    );
  }

  get usage() {
    return {
      spentUsd: this.spentUsd,
      remainingUsd: Math.max(0, this.policy.streamBudgetUsd - this.spentUsd),
      analyzedCandidates: this.analyzedCandidates,
    };
  }

  decide(signals: VisualAnalysisSignals): VisualAnalysisDecision {
    if (signals.cached) {
      return {
        level: "cached",
        maximumFrames: 0,
        maximumVideoSeconds: 0,
        estimatedCostUsd: 0,
        reason: "Reusable visual context already exists for this source window.",
      };
    }
    if (!signals.hasPaidProvider) {
      return this.localOnly("No visual model provider is configured.");
    }
    if (this.analyzedCandidates >= this.policy.maximumCandidates) {
      return this.localOnly("The per-run candidate limit has been reached.");
    }

    const visuallyPromising = signals.localVisualScore >= 5.5;
    const corroborated = signals.audioScore >= 5 || signals.chatScore >= 6;
    const visualOnly = !signals.hasTranscriptEvidence && visuallyPromising;
    if (
      signals.candidateScore < this.policy.minimumCandidateScore &&
      !visualOnly &&
      !corroborated
    ) {
      return this.localOnly("The candidate is not strong enough for paid analysis.");
    }

    const screenshotCost = this.policy.screenshotCandidateCostUsd;
    if (!this.canReserve(screenshotCost)) {
      return this.localOnly("The stream visual-analysis budget is exhausted.");
    }

    const strong =
      signals.candidateScore >= this.policy.strongCandidateScore ||
      (visuallyPromising && corroborated) ||
      visualOnly;
    const temporal =
      strong &&
      (signals.fastAction ||
        signals.ambiguity >= 0.55 ||
        signals.contentType === "gaming" ||
        signals.contentType === "gameplay_only");
    this.reserve(screenshotCost);
    this.analyzedCandidates += 1;
    return {
      level: temporal ? "screenshots_then_video" : "screenshots",
      maximumFrames: Math.min(
        this.policy.maximumScreenshotCount,
        this.policy.screenshotCount + (strong ? 2 : 0)
      ),
      maximumVideoSeconds: temporal ? this.policy.maximumVideoSeconds : 0,
      estimatedCostUsd: screenshotCost,
      reason: temporal
        ? "Use screenshots first and permit one targeted temporal pass if needed."
        : "A bounded screenshot pass should answer the missing visual question.",
    };
  }

  reserveVideoEscalation(): boolean {
    if (!this.canReserve(this.policy.videoEscalationCostUsd)) return false;
    this.reserve(this.policy.videoEscalationCostUsd);
    return true;
  }

  private localOnly(reason: string): VisualAnalysisDecision {
    return {
      level: "local_only",
      maximumFrames: 0,
      maximumVideoSeconds: 0,
      estimatedCostUsd: 0,
      reason,
    };
  }

  private canReserve(costUsd: number): boolean {
    return this.spentUsd + costUsd <= this.policy.streamBudgetUsd + 1e-9;
  }

  private reserve(costUsd: number): void {
    this.spentUsd = Math.round((this.spentUsd + costUsd) * 1_000_000) / 1_000_000;
  }
}
