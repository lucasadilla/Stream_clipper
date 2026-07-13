"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  CAPTION_FONT_PRESETS,
  normalizeCaptionAppearance,
  type CaptionAnimation,
  type CaptionAppearance,
  type CaptionCapitalization,
  type CaptionHorizontalPosition,
  type CaptionVerticalPosition,
} from "@/lib/captionAppearance";
import {
  appearanceMatchesPreset,
  deleteCustomCaptionPreset,
  findCaptionPreset,
  getAllCaptionPresets,
  readActiveCaptionPresetId,
  saveCustomCaptionPreset,
  writeActiveCaptionPresetId,
  type CaptionPreset,
} from "@/lib/captionPresets";
import { cn } from "@/lib/cn";

interface CaptionAppearancePanelProps {
  appearance: CaptionAppearance;
  onChange: (appearance: CaptionAppearance) => void;
  disabled?: boolean;
  hasWordTimings?: boolean;
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
        "h-7 min-w-[2rem] rounded-lg border px-2 text-[10px] font-semibold transition-colors",
        active
          ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-black"
          : "border-[#21301f] bg-[#070a07] text-[var(--color-muted)] hover:border-[var(--color-accent)] hover:text-white"
      )}
    >
      {label}
    </button>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
      {children}
    </span>
  );
}

export function CaptionAppearancePanel({
  appearance,
  onChange,
  disabled,
  hasWordTimings = false,
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
    const next = normalizeCaptionAppearance({ ...appearance, ...partial });
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
    onChange(normalizeCaptionAppearance(preset.appearance));
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
          "rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors",
          open
            ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-black"
            : "border-[#21301f] bg-[#070a07] text-[var(--color-muted)] hover:border-[var(--color-accent)] hover:text-white",
          disabled && "pointer-events-none opacity-40"
        )}
      >
        Caption style
        {activePreset && (
          <span
            className={cn(
              "ml-1.5 text-[10px]",
              open ? "text-black" : "text-[var(--color-accent)]"
            )}
          >
            / {activePreset.name}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 max-h-[min(80vh,560px)] w-[min(92vw,320px)] space-y-3 overflow-y-auto rounded-lg border border-[var(--color-card-border)] bg-[#050705] p-3 shadow-[0_24px_80px_rgba(0,0,0,0.55)]">
          <div className="space-y-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-accent)]">
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
                placeholder="Save current as..."
                className="h-8 min-w-0 flex-1 rounded-lg border border-[#21301f] bg-[#020302] px-2 text-xs text-white focus:border-[var(--color-accent)] focus:outline-none"
              />
              <button
                type="button"
                onClick={handleSavePreset}
                className="h-8 shrink-0 rounded-lg bg-[var(--color-accent)] px-2.5 text-xs font-semibold text-black hover:bg-[var(--color-accent-hover)]"
              >
                Save
              </button>
            </div>
            {saveError && (
              <p className="text-[10px] text-[var(--color-danger)]">{saveError}</p>
            )}
          </div>

          <div className="space-y-3 border-t border-[var(--color-card-border)] pt-3">
            <label className="block space-y-1">
              <SectionLabel>Font</SectionLabel>
              <select
                value={
                  CAPTION_FONT_PRESETS.includes(
                    appearance.fontFamily as (typeof CAPTION_FONT_PRESETS)[number]
                  )
                    ? appearance.fontFamily
                    : "__custom__"
                }
                onChange={(e) => {
                  if (e.target.value !== "__custom__") {
                    patch({ fontFamily: e.target.value });
                  }
                }}
                className="h-8 w-full rounded-lg border border-[#21301f] bg-[#020302] px-2 text-xs text-white focus:border-[var(--color-accent)] focus:outline-none"
              >
                {CAPTION_FONT_PRESETS.map((font) => (
                  <option key={font} value={font}>
                    {font}
                  </option>
                ))}
                <option value="__custom__">Custom...</option>
              </select>
              <input
                type="text"
                value={appearance.fontFamily}
                onChange={(e) => patch({ fontFamily: e.target.value })}
                placeholder="Font family name"
                className="h-8 w-full rounded-lg border border-[#21301f] bg-[#020302] px-2 text-xs text-white focus:border-[var(--color-accent)] focus:outline-none"
              />
            </label>

            <label className="block space-y-1">
              <SectionLabel>Size / {appearance.fontSize}px</SectionLabel>
              <input
                type="range"
                min={12}
                max={72}
                value={appearance.fontSize}
                onChange={(e) => patch({ fontSize: Number(e.target.value) })}
                className="w-full accent-[var(--color-accent)]"
              />
            </label>

            <label className="block space-y-1">
              <SectionLabel>Color</SectionLabel>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={appearance.color}
                  onChange={(e) => patch({ color: e.target.value.toUpperCase() })}
                  className="h-8 w-10 cursor-pointer rounded border border-[#21301f] bg-transparent"
                />
                <input
                  type="text"
                  value={appearance.color}
                  onChange={(e) => patch({ color: e.target.value })}
                  placeholder="#FFFFFF"
                  className="h-8 min-w-0 flex-1 rounded-lg border border-[#21301f] bg-[#020302] px-2 font-mono text-xs text-white focus:border-[var(--color-accent)] focus:outline-none"
                />
              </div>
            </label>

            <div className="space-y-1">
              <SectionLabel>Weight / style</SectionLabel>
              <div className="flex flex-wrap gap-1">
                <PosBtn
                  label="Bold"
                  active={appearance.fontWeight === "bold"}
                  onClick={() =>
                    patch({
                      fontWeight:
                        appearance.fontWeight === "bold" ? "normal" : "bold",
                    })
                  }
                />
                <PosBtn
                  label="Italic"
                  active={appearance.italic}
                  onClick={() => patch({ italic: !appearance.italic })}
                />
              </div>
            </div>

            <label className="block space-y-1">
              <SectionLabel>Capitalization</SectionLabel>
              <select
                value={appearance.capitalization}
                onChange={(e) =>
                  patch({
                    capitalization: e.target.value as CaptionCapitalization,
                  })
                }
                className="h-8 w-full rounded-lg border border-[#21301f] bg-[#020302] px-2 text-xs text-white focus:border-[var(--color-accent)] focus:outline-none"
              >
                <option value="none">As typed</option>
                <option value="uppercase">UPPERCASE</option>
                <option value="lowercase">lowercase</option>
                <option value="title">Title Case</option>
              </select>
            </label>

            <div className="space-y-1">
              <SectionLabel>Background</SectionLabel>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={appearance.backgroundColor}
                  onChange={(e) =>
                    patch({ backgroundColor: e.target.value.toUpperCase() })
                  }
                  className="h-8 w-10 cursor-pointer rounded border border-[#21301f] bg-transparent"
                />
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(appearance.backgroundOpacity * 100)}
                  onChange={(e) =>
                    patch({ backgroundOpacity: Number(e.target.value) / 100 })
                  }
                  className="w-full accent-[var(--color-accent)]"
                />
                <span className="w-8 shrink-0 text-right text-[10px] text-[var(--color-muted)]">
                  {Math.round(appearance.backgroundOpacity * 100)}%
                </span>
              </div>
            </div>

            <div className="space-y-1">
              <SectionLabel>Outline / {appearance.outlineWidth}</SectionLabel>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={appearance.outlineColor}
                  onChange={(e) =>
                    patch({ outlineColor: e.target.value.toUpperCase() })
                  }
                  className="h-8 w-10 cursor-pointer rounded border border-[#21301f] bg-transparent"
                />
                <input
                  type="range"
                  min={0}
                  max={8}
                  step={0.5}
                  value={appearance.outlineWidth}
                  onChange={(e) =>
                    patch({ outlineWidth: Number(e.target.value) })
                  }
                  className="w-full accent-[var(--color-accent)]"
                />
              </div>
            </div>

            <label className="block space-y-1">
              <SectionLabel>Shadow / {appearance.shadow}</SectionLabel>
              <input
                type="range"
                min={0}
                max={8}
                step={0.5}
                value={appearance.shadow}
                onChange={(e) => patch({ shadow: Number(e.target.value) })}
                className="w-full accent-[var(--color-accent)]"
              />
            </label>

            <div className="space-y-1">
              <SectionLabel>Karaoke</SectionLabel>
              <div className="flex items-center gap-2">
                <PosBtn
                  label={appearance.karaokeEnabled ? "On" : "Off"}
                  active={appearance.karaokeEnabled}
                  onClick={() =>
                    patch({ karaokeEnabled: !appearance.karaokeEnabled })
                  }
                />
                <input
                  type="color"
                  value={appearance.highlightColor}
                  disabled={!appearance.karaokeEnabled}
                  onChange={(e) =>
                    patch({ highlightColor: e.target.value.toUpperCase() })
                  }
                  className="h-8 w-10 cursor-pointer rounded border border-[#21301f] bg-transparent disabled:opacity-40"
                  title="Highlight color"
                />
              </div>
              {!hasWordTimings && (
                <p className="text-[10px] text-[var(--color-muted)]">
                  Word timings needed for karaoke highlight
                </p>
              )}
            </div>

            <label className="block space-y-1">
              <SectionLabel>Animation</SectionLabel>
              <select
                value={appearance.animation}
                onChange={(e) =>
                  patch({ animation: e.target.value as CaptionAnimation })
                }
                className="h-8 w-full rounded-lg border border-[#21301f] bg-[#020302] px-2 text-xs text-white focus:border-[var(--color-accent)] focus:outline-none"
              >
                <option value="none">None</option>
                <option value="fade">Fade</option>
                <option value="pop">Pop</option>
                <option value="slideUp">Slide up</option>
              </select>
            </label>

            <div className="space-y-1">
              <SectionLabel>Position</SectionLabel>
              <div className="flex flex-wrap gap-1">
                {(["top", "center", "bottom"] as CaptionVerticalPosition[]).map(
                  (v) => (
                    <PosBtn
                      key={v}
                      label={v}
                      active={appearance.vertical === v}
                      onClick={() => patch({ vertical: v })}
                    />
                  )
                )}
              </div>
              <div className="flex flex-wrap gap-1">
                {(
                  ["left", "center", "right"] as CaptionHorizontalPosition[]
                ).map((h) => (
                  <PosBtn
                    key={h}
                    label={h}
                    active={appearance.horizontal === h}
                    onClick={() => patch({ horizontal: h })}
                  />
                ))}
              </div>
            </div>

            <label className="block space-y-1">
              <SectionLabel>
                Edge offset / {appearance.verticalOffsetPercent}%
              </SectionLabel>
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
    <div className="group relative">
      <button
        type="button"
        onClick={onClick}
        title={preset.name}
        className={cn(
          "h-7 max-w-[9rem] truncate rounded-lg border px-2.5 text-[10px] font-semibold transition-colors",
          active
            ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-black"
            : "border-[#21301f] bg-[#070a07] text-[#dfead8] hover:border-[var(--color-accent)] hover:text-white"
        )}
        style={{
          boxShadow: active ? `0 0 0 1px ${preset.appearance.color}33` : undefined,
        }}
      >
        <span
          className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle"
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
          className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full border border-[#2d3f2a] bg-[#111811] text-[9px] text-[#dfead8] hover:bg-[var(--color-danger)] hover:text-white group-hover:flex"
          title="Delete preset"
        >
          x
        </button>
      )}
    </div>
  );
}
