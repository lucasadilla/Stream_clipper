"use client";

import { useEffect, useState } from "react";
import {
  CAPTION_FONT_PRESETS,
  type CaptionAppearance,
  type CaptionHorizontalPosition,
  type CaptionVerticalPosition,
} from "@/lib/captionAppearance";
import {
  appearanceMatchesPreset,
  deleteCustomCaptionPreset,
  getAllCaptionPresets,
  readActiveCaptionPresetId,
  saveCustomCaptionPreset,
  writeActiveCaptionPresetId,
  findCaptionPreset,
  type CaptionPreset,
} from "@/lib/captionPresets";
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
  const [presets, setPresets] = useState<CaptionPreset[]>([]);
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const [saveName, setSaveName] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setPresets(getAllCaptionPresets());
    const storedId = readActiveCaptionPresetId();
    if (storedId) {
      const stored = findCaptionPreset(storedId);
      if (stored && appearanceMatchesPreset(appearance, stored)) {
        setActivePresetId(storedId);
        return;
      }
    }
    const match = getAllCaptionPresets().find((p) =>
      appearanceMatchesPreset(appearance, p)
    );
    setActivePresetId(match?.id ?? null);
  }, [appearance]);

  useEffect(() => {
    if (!open) return;
    setPresets(getAllCaptionPresets());
  }, [open]);

  function refreshPresets() {
    const next = getAllCaptionPresets();
    setPresets(next);
    return next;
  }

  function patch(partial: Partial<CaptionAppearance>) {
    const next = { ...appearance, ...partial };
    onChange(next);
    if (activePresetId) {
      const preset = presets.find((p) => p.id === activePresetId);
      if (preset && !appearanceMatchesPreset(next, preset)) {
        setActivePresetId(null);
        writeActiveCaptionPresetId(null);
      }
    }
  }

  function applyPreset(preset: CaptionPreset) {
    onChange(preset.appearance);
    setActivePresetId(preset.id);
    writeActiveCaptionPresetId(preset.id);
    setSaveError(null);
  }

  function handleSavePreset() {
    const name = saveName.trim();
    if (!name) {
      setSaveError("Enter a preset name");
      return;
    }
    const duplicate = presets.some(
      (p) => p.name.toLowerCase() === name.toLowerCase()
    );
    if (duplicate) {
      setSaveError("A preset with that name already exists");
      return;
    }
    const saved = saveCustomCaptionPreset(name, appearance);
    const next = refreshPresets();
    setActivePresetId(saved.id);
    writeActiveCaptionPresetId(saved.id);
    setSaveName("");
    setSaveError(null);
    void next;
  }

  function handleDeletePreset(preset: CaptionPreset) {
    if (preset.builtIn) return;
    deleteCustomCaptionPreset(preset.id);
    const next = refreshPresets();
    if (activePresetId === preset.id) {
      setActivePresetId(null);
      writeActiveCaptionPresetId(null);
    }
    void next;
  }

  const activePreset = presets.find((p) => p.id === activePresetId) ?? null;
  const builtInPresets = presets.filter((p) => p.builtIn);
  const customPresets = presets.filter((p) => !p.builtIn);

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
        {activePreset && (
          <span className="ml-1.5 text-[10px] text-[var(--color-accent)]">
            · {activePreset.name}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 w-[min(92vw,320px)] rounded-xl border border-[#333] bg-[#141414] shadow-xl p-3 space-y-3 max-h-[min(80vh,560px)] overflow-y-auto">
          {/* Presets */}
          <div className="space-y-2">
            <span className="text-[10px] uppercase tracking-wide text-[#888]">
              Presets
            </span>
            <div className="flex flex-wrap gap-1.5">
              {builtInPresets.map((preset) => (
                <PresetChip
                  key={preset.id}
                  preset={preset}
                  active={activePresetId === preset.id}
                  onClick={() => applyPreset(preset)}
                />
              ))}
            </div>
            {customPresets.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {customPresets.map((preset) => (
                  <PresetChip
                    key={preset.id}
                    preset={preset}
                    active={activePresetId === preset.id}
                    onClick={() => applyPreset(preset)}
                    onDelete={() => handleDeletePreset(preset)}
                  />
                ))}
              </div>
            )}
            <div className="flex gap-1.5 pt-1">
              <input
                type="text"
                value={saveName}
                onChange={(e) => {
                  setSaveName(e.target.value);
                  setSaveError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSavePreset();
                }}
                placeholder="Save current as…"
                className="flex-1 h-8 rounded-lg bg-[#0d0d0d] border border-[#333] text-xs text-white px-2"
              />
              <button
                type="button"
                onClick={handleSavePreset}
                className="shrink-0 h-8 px-2.5 rounded-lg text-xs font-medium border border-[var(--color-accent)]/50 bg-[var(--color-accent)]/15 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/25"
              >
                Save
              </button>
            </div>
            {saveError && (
              <p className="text-[10px] text-[var(--color-danger)]">{saveError}</p>
            )}
          </div>

          <div className="border-t border-[#2a2a2a] pt-3 space-y-3">
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
        </div>
      )}
    </div>
  );
}

function PresetChip({
  preset,
  active,
  onClick,
  onDelete,
}: {
  preset: CaptionPreset;
  active: boolean;
  onClick: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="relative group">
      <button
        type="button"
        onClick={onClick}
        title={preset.name}
        className={cn(
          "h-7 px-2.5 text-[10px] rounded-full border transition-colors max-w-[9rem] truncate",
          active
            ? "border-[var(--color-accent)] bg-[var(--color-accent)]/20 text-[var(--color-accent)]"
            : "border-[#444] text-[#ccc] hover:border-[#666] hover:text-white"
        )}
        style={{
          boxShadow: active ? `0 0 0 1px ${preset.appearance.color}33` : undefined,
        }}
      >
        <span
          className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle"
          style={{ backgroundColor: preset.appearance.color }}
          aria-hidden
        />
        {preset.name}
      </button>
      {onDelete && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="absolute -top-1 -right-1 hidden group-hover:flex h-4 w-4 items-center justify-center rounded-full bg-[#333] border border-[#555] text-[9px] text-[#ccc] hover:bg-[var(--color-danger)] hover:text-white"
          title="Delete preset"
        >
          ×
        </button>
      )}
    </div>
  );
}
