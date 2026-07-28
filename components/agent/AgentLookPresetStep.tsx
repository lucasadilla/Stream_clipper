"use client";

import { cn } from "@/lib/cn";
import {
  CONTENT_LOOK_PRESETS,
  type ContentLookPresetId,
} from "@/lib/contentLookPresets";

interface AgentLookPresetStepProps {
  value: ContentLookPresetId | null;
  onChange: (id: ContentLookPresetId) => void;
  analyzing?: boolean;
  analysisError?: string | null;
}

export function AgentLookPresetStep({
  value,
  onChange,
  analyzing,
  analysisError,
}: AgentLookPresetStepProps) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-[var(--color-foreground)]">
          How should it look?
        </h2>
        <p className="text-xs text-[var(--color-muted)]">
          Pick a layout style for this clip. We run face detection when needed.
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
                "rounded-xl border p-4 text-left transition",
                selected
                  ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 ring-1 ring-[var(--color-accent)]"
                  : "border-[var(--color-card-border)] bg-[var(--color-card)] hover:border-[#4a5a48]"
              )}
            >
              <p className="text-sm font-semibold">{preset.label}</p>
              <p className="mt-1 text-xs leading-relaxed text-[var(--color-muted)]">
                {preset.description}
              </p>
            </button>
          );
        })}
      </div>

      {analyzing && (
        <p className="flex items-center gap-2 text-xs text-[var(--color-accent)]">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-accent)]" />
          Analyzing facecam for this clip…
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
