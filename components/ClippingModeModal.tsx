"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Clapperboard, Loader2, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/cn";
import type { SessionMode } from "@/lib/sessionMode";
import { Button } from "@/components/ui/button";

interface ClippingModeModalProps {
  open: boolean;
  loading?: boolean;
  selectedMode?: SessionMode | null;
  onClose: () => void;
  onSelect: (mode: SessionMode) => void;
}

const MODES: Array<{
  id: SessionMode;
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
    tagline: "Hands-off",
    description: "Describe the moments you want — we find and render the clips.",
    icon: Sparkles,
  },
];

export function ClippingModeModal({
  open,
  loading,
  selectedMode = null,
  onClose,
  onSelect,
}: ClippingModeModalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
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
        </div>

        <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5">
          {MODES.map((mode) => {
            const Icon = mode.icon;
            const selected = selectedMode === mode.id;
            const dimmed = Boolean(loading && selectedMode && !selected);

            return (
              <button
                key={mode.id}
                type="button"
                disabled={loading}
                onClick={() => onSelect(mode.id)}
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
                  {selected && loading ? "Starting…" : "Select"}
                </span>
              </button>
            );
          })}
        </div>

        {!loading ? (
          <div className="flex justify-end border-t border-[var(--color-card-border)] px-4 py-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="text-[var(--color-muted)] hover:bg-[#0a1008] hover:text-white"
            >
              Cancel
            </Button>
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  );
}
