"use client";

import { cn } from "@/lib/cn";
import type { AgentCadence } from "@/lib/agentWizard";
import { Radio, Timer } from "lucide-react";

interface AgentCadenceChooserProps {
  onChoose: (cadence: Extract<AgentCadence, "live_now" | "after_stream">) => void;
  disabled?: boolean;
}

const OPTIONS: Array<{
  id: Extract<AgentCadence, "live_now" | "after_stream">;
  label: string;
  description: string;
  icon: typeof Radio;
}> = [
  {
    id: "live_now",
    label: "Clip as it happens",
    description:
      "Suggestions roll in while you stream — pick and edit moments as they land.",
    icon: Radio,
  },
  {
    id: "after_stream",
    label: "Clip after the stream",
    description:
      "We keep transcribing in the background, then propose ~10 clips when you go offline.",
    icon: Timer,
  },
];

export function AgentCadenceChooser({
  onChoose,
  disabled,
}: AgentCadenceChooserProps) {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-4 py-12">
      <div className="space-y-1 text-center">
        <h2 className="text-lg font-semibold text-[var(--color-foreground)]">
          How should Agent clip this live stream?
        </h2>
        <p className="text-xs text-[var(--color-muted)]">
          Transcription starts either way. Choose when you want clip suggestions.
        </p>
      </div>

      <div className="grid gap-3">
        {OPTIONS.map((opt) => {
          const Icon = opt.icon;
          return (
            <button
              key={opt.id}
              type="button"
              disabled={disabled}
              onClick={() => onChoose(opt.id)}
              className={cn(
                "flex items-start gap-3 rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)] p-4 text-left transition",
                "hover:border-[var(--color-accent)] disabled:opacity-50"
              )}
            >
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#141814] text-[var(--color-accent)]">
                <Icon className="h-4 w-4" />
              </span>
              <span>
                <span className="block text-sm font-semibold">{opt.label}</span>
                <span className="mt-1 block text-xs leading-relaxed text-[var(--color-muted)]">
                  {opt.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
