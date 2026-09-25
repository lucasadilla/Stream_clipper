"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Clapperboard, Loader2, Radio, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/cn";
import type { SessionMode } from "@/lib/sessionMode";
import { Button } from "@/components/ui/button";

export type ClippingEntryMode = SessionMode | "autopilot";

interface ClippingModeModalProps {
  open: boolean;
  loading?: boolean;
  selectedMode?: ClippingEntryMode | null;
  agentPrompt?: string;
  onAgentPromptChange?: (value: string) => void;
  preview?: {
    title: string;
    creator: string | null;
    thumbnailUrl: string | null;
    platform: "youtube" | "twitch" | "kick";
  } | null;
  onClose: () => void;
  onSelect: (mode: ClippingEntryMode) => void;
}

const MODES: Array<{
  id: ClippingEntryMode;
  label: string;
  tagline: string;
  description: string;
  icon: typeof Clapperboard;
}> = [
  {
    id: "timeline",
    label: "Timeline",
    tagline: "Hands-on",
    description: "Scrub, cut, caption, and export on a full editing timeline.",
    icon: Clapperboard,
  },
  {
    id: "agent",
    label: "Agent",
    tagline: "Guided",
    description:
      "Auto clips for VODs and live — as moments happen, or after the stream ends.",
    icon: Sparkles,
  },
  {
    id: "autopilot",
    label: "Autopilot",
    tagline: "Hands-free",
    description:
      "Connect your channel once, then let Clipper monitor, create, and publish.",
    icon: Radio,
  },
];

export function ClippingModeModal({
  open,
  loading,
  selectedMode = null,
  agentPrompt = "",
  onAgentPromptChange,
  preview,
  onClose,
  onSelect,
}: ClippingModeModalProps) {
  const [mounted, setMounted] = useState(false);
  const [pendingMode, setPendingMode] = useState<ClippingEntryMode | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    setPendingMode(null);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  useEffect(() => {
    if (!open || loading) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, loading, onClose]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className="marketing-shell fixed inset-0 z-[2147483000] flex items-center justify-center p-4 sm:p-6"
      role="presentation"
    >
      <button
        type="button"
        aria-label="Close mode picker"
        className="absolute inset-0 bg-[#020302]/80 backdrop-blur-sm"
        disabled={loading}
        onClick={() => {
          if (!loading) onClose();
        }}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="clipping-mode-title"
        className="relative z-10 w-full max-w-xl overflow-hidden border border-[var(--color-card-border)] bg-[#050805] shadow-[0_24px_80px_rgba(0,0,0,0.65)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="relative border-b border-[var(--color-card-border)] px-6 py-5">
          {!loading ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              className="absolute top-3 right-3 text-[var(--color-muted)] hover:bg-[#0a1008] hover:text-white"
              aria-label="Close"
            >
              <X className="size-4" strokeWidth={2.25} />
            </Button>
          ) : null}

          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-accent)]">
            Start clipping
          </p>
          <h2
            id="clipping-mode-title"
            className="mt-2 pr-8 text-xl font-semibold tracking-tight text-white sm:text-2xl"
          >
            How do you want to work?
          </h2>
          <p className="mt-2 max-w-md text-sm leading-6 text-[var(--color-muted)]">
            One active session at a time. Starting a new one replaces your
            current workspace.
          </p>
          {preview ? (
            <div className="mt-4 flex items-center gap-3 border-t border-[var(--color-card-border)] pt-4">
              {preview.thumbnailUrl ? (
                // The bounded preview endpoint returns remote creator artwork.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={preview.thumbnailUrl}
                  alt=""
                  className="h-12 w-20 shrink-0 object-cover"
                />
              ) : null}
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">
                  {preview.title}
                </p>
                <p className="mt-1 truncate text-xs text-white/42">
                  {preview.creator || preview.platform}
                </p>
              </div>
            </div>
          ) : null}
        </div>

        <div className="grid gap-3 p-4 sm:grid-cols-3 sm:p-5">
          {MODES.map((mode) => {
            const Icon = mode.icon;
            const selected = (loading ? selectedMode : pendingMode) === mode.id;
            const dimmed = Boolean(loading && selectedMode && !selected);

            return (
              <button
                key={mode.id}
                type="button"
                disabled={loading}
                onClick={() => setPendingMode(mode.id)}
                className={cn(
                  "group flex flex-col gap-3 border border-[var(--color-card-border)] bg-[#020302] p-4 text-left transition-colors",
                  "hover:border-[var(--color-accent)] hover:bg-[#071007]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]",
                  "disabled:cursor-wait",
                  selected && "border-[var(--color-accent)] bg-[#071007]",
                  dimmed && "opacity-40"
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <span
                    className={cn(
                      "flex size-10 items-center justify-center border border-[var(--color-card-border)] bg-[#050805] text-[var(--color-muted)] transition-colors",
                      "group-hover:border-[var(--color-accent)]/60 group-hover:text-[var(--color-accent)]",
                      selected &&
                        "border-[var(--color-accent)] text-[var(--color-accent)]"
                    )}
                  >
                    {selected && loading ? (
                      <Loader2
                        className="size-4 animate-spin"
                        strokeWidth={2.25}
                      />
                    ) : (
                      <Icon className="size-4" strokeWidth={2.25} />
                    )}
                  </span>
                  <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-muted)]">
                    {mode.tagline}
                  </span>
                </div>

                <div>
                  <p className="text-base font-semibold text-white">{mode.label}</p>
                  <p className="mt-1.5 text-xs leading-5 text-[var(--color-muted)]">
                    {mode.description}
                  </p>
                </div>

                <span
                  className={cn(
                    "mt-auto text-[10px] font-semibold uppercase tracking-[0.14em]",
                    selected
                      ? "text-[var(--color-accent)]"
                      : "text-white/40 group-hover:text-[var(--color-accent)]"
                  )}
                >
                  {selected && loading ? "Starting…" : selected ? "Selected" : "Select"}
                </span>
              </button>
            );
          })}
        </div>

        {pendingMode === "agent" && !loading ? (
          <div className="border-t border-[var(--color-card-border)] px-5 py-4">
            <label htmlFor="agent-onboarding-prompt" className="text-xs font-semibold text-white">
              Tell Clipper what you&apos;re looking for
            </label>
            <input
              id="agent-onboarding-prompt"
              value={agentPrompt}
              onChange={(event) => onAgentPromptChange?.(event.target.value)}
              placeholder="Find the funniest moments"
              className="mt-2 h-11 w-full border border-[var(--color-card-border)] bg-[#020302] px-3 text-sm text-white placeholder:text-white/30 focus:border-[var(--color-accent)] focus:outline-none"
            />
          </div>
        ) : null}

        {!loading ? (
          <div className="flex justify-end gap-2 border-t border-[var(--color-card-border)] px-4 py-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="text-[var(--color-muted)] hover:bg-[#0a1008] hover:text-white"
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!pendingMode}
              onClick={() => pendingMode && onSelect(pendingMode)}
            >
              Continue
            </Button>
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  );
}
