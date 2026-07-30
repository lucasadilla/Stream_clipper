"use client";

import { cn } from "@/lib/cn";
import {
  CONTENT_LOOK_PRESETS,
  type ContentLookPresetId,
} from "@/lib/contentLookPresets";
import {
  LookLayoutMock,
  LookPresetGlyph,
} from "@/components/agent/AgentStudioPreviews";

interface AgentLookPresetStepProps {
  value: ContentLookPresetId | null;
  onChange: (id: ContentLookPresetId) => void;
  analyzing?: boolean;
  analysisError?: string | null;
  frameUrl?: string | null;
}

export function AgentLookPresetStep({
  value,
  onChange,
  analyzing,
  analysisError,
  frameUrl = null,
}: AgentLookPresetStepProps) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-[var(--color-foreground)]">
          How should it look?
        </h2>
        <p className="text-xs text-[var(--color-muted)]">
          Pick a layout — the preview on each card shows how the Short will be
          composed.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {CONTENT_LOOK_PRESETS.map((preset) => {
          const selected = value === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => onChange(preset.id)}
              className={cn(
                "flex gap-3 rounded-xl border p-3 text-left transition",
                selected
                  ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 ring-1 ring-[var(--color-accent)]"
                  : "border-[var(--color-card-border)] bg-[var(--color-card)] hover:border-[#4a5a48]"
              )}
            >
              <LookLayoutMock
                presetId={preset.id}
                frameUrl={frameUrl}
                className="h-[5.5rem] w-[3.1rem] shrink-0 rounded-lg"
              />
              <span className="min-w-0 self-center">
                <span className="flex items-center gap-1.5 text-sm font-semibold">
                  <LookPresetGlyph
                    presetId={preset.id}
                    className="h-3.5 w-3.5 text-[var(--color-accent)]"
                  />
                  {preset.label}
                </span>
                <span className="mt-1 block text-xs font-medium text-[var(--color-foreground)]">
                  {preset.behavior}
                </span>
                <span className="mt-0.5 block text-xs leading-relaxed text-[var(--color-muted)]">
                  {preset.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {analyzing && (
        <p className="flex items-center gap-2 text-xs text-[var(--color-muted)]">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-accent)]" />
          Refining facecam crop in the background — you can continue anytime.
        </p>
      )}
      {analysisError && (
        <p className="text-xs text-[var(--color-warning,#e6b84d)]">
          {analysisError} — you can continue; layout will use best effort.
        </p>
      )}
    </div>
  );
}
