"use client";

import { useState } from "react";
import {
  CAPTION_FONT_PRESETS,
  type CaptionAppearance,
  type CaptionHorizontalPosition,
  type CaptionVerticalPosition,
} from "@/lib/captionAppearance";
import { cn } from "@/lib/utils";

interface CaptionAppearancePanelProps {
  appearance: CaptionAppearance;
  onChange: (appearance: CaptionAppearance) => void;
  disabled?: boolean;
}

function PosBtn({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-7 min-w-[2rem] px-2 text-[10px] rounded border transition-colors",
        active
          ? "border-[var(--color-accent)] bg-[var(--color-accent)]/20 text-[var(--color-accent)]"
          : "border-[#444] text-[#aaa] hover:border-[#666] hover:text-white"
      )}
    >
      {label}
    </button>
  );
}

export function CaptionAppearancePanel({
  appearance,
  onChange,
  disabled,
}: CaptionAppearancePanelProps) {
  const [open, setOpen] = useState(false);

  function patch(partial: Partial<CaptionAppearance>) {
    onChange({ ...appearance, ...partial });
  }

  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "text-xs px-3 py-1.5 rounded-full border transition-colors",
          open
            ? "border-[#666] bg-[#252525] text-white"
            : "border-[#444] bg-[#1a1a1a] text-[#aaa] hover:border-[#666]",
          disabled && "opacity-40 pointer-events-none"
        )}
      >
        Caption style
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 w-[min(92vw,320px)] rounded-xl border border-[#333] bg-[#141414] shadow-xl p-3 space-y-3">
          {/* Font */}
          <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-wide text-[#888]">Font</span>
            <select
              value={
                CAPTION_FONT_PRESETS.includes(
                  appearance.fontFamily as (typeof CAPTION_FONT_PRESETS)[number]
                )
                  ? appearance.fontFamily
                  : "__custom__"
              }
              onChange={(e) => {
                if (e.target.value !== "__custom__") patch({ fontFamily: e.target.value });
              }}
              className="w-full h-8 rounded-lg bg-[#0d0d0d] border border-[#333] text-xs text-white px-2"
            >
              {CAPTION_FONT_PRESETS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
              <option value="__custom__">Custom…</option>
            </select>
            <input
              type="text"
              value={appearance.fontFamily}
              onChange={(e) => patch({ fontFamily: e.target.value })}
              placeholder="Font family name"
              className="w-full h-8 rounded-lg bg-[#0d0d0d] border border-[#333] text-xs text-white px-2"
            />
          </label>

          {/* Size */}
          <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-wide text-[#888]">
              Size — {appearance.fontSize}px
            </span>
            <input
              type="range"
              min={12}
              max={72}
              value={appearance.fontSize}
              onChange={(e) => patch({ fontSize: Number(e.target.value) })}
              className="w-full accent-[var(--color-accent)]"
            />
          </label>

          {/* Color */}
          <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-wide text-[#888]">Color</span>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={appearance.color}
                onChange={(e) => patch({ color: e.target.value.toUpperCase() })}
                className="h-8 w-10 rounded border border-[#333] bg-transparent cursor-pointer"
              />
              <input
                type="text"
                value={appearance.color}
                onChange={(e) => patch({ color: e.target.value })}
                placeholder="#FFFFFF"
                className="flex-1 h-8 rounded-lg bg-[#0d0d0d] border border-[#333] text-xs text-white px-2 font-mono"
              />
            </div>
          </label>

          {/* Position */}
          <div className="space-y-1">
            <span className="text-[10px] uppercase tracking-wide text-[#888]">Position</span>
            <div className="flex flex-wrap gap-1">
              {(["top", "center", "bottom"] as CaptionVerticalPosition[]).map((v) => (
                <PosBtn
                  key={v}
                  label={v}
                  active={appearance.vertical === v}
                  onClick={() => patch({ vertical: v })}
                />
              ))}
            </div>
            <div className="flex flex-wrap gap-1">
              {(["left", "center", "right"] as CaptionHorizontalPosition[]).map((h) => (
                <PosBtn
                  key={h}
                  label={h}
                  active={appearance.horizontal === h}
                  onClick={() => patch({ horizontal: h })}
                />
              ))}
            </div>
          </div>

          {/* Offset */}
          <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-wide text-[#888]">
              Edge offset — {appearance.verticalOffsetPercent}%
            </span>
            <input
              type="range"
              min={2}
              max={35}
              value={appearance.verticalOffsetPercent}
              onChange={(e) =>
                patch({ verticalOffsetPercent: Number(e.target.value) })
              }
              className="w-full accent-[var(--color-accent)]"
            />
          </label>
        </div>
      )}
    </div>
  );
}
