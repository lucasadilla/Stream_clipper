import {
  normalizeCaptionAppearance,
  type CaptionAppearance,
} from "@/lib/captionAppearance";

export interface CaptionPreset {
  id: string;
  name: string;
  appearance: CaptionAppearance;
  builtIn: boolean;
}

export interface SavedCaptionPreset {
  id: string;
  name: string;
  appearance: CaptionAppearance;
  createdAt: string;
}

export const CAPTION_PRESETS_STORAGE_KEY = "stream-clipper-caption-presets";
export const CAPTION_PRESET_ID_STORAGE_KEY = "stream-clipper-caption-preset-id";

export const BUILT_IN_CAPTION_PRESETS: CaptionPreset[] = [
  {
    id: "karaoke-yellow",
    name: "Karaoke yellow",
    builtIn: true,
    appearance: normalizeCaptionAppearance({
      fontFamily: "Arial",
      fontSize: 56,
      color: "#FFFFFF",
      vertical: "bottom",
      horizontal: "center",
      verticalOffsetPercent: 13,
      backgroundOpacity: 0,
      outlineWidth: 0,
      shadow: 6,
      fontWeight: "normal",
      karaokeEnabled: true,
      highlightColor: "#FFFF00",
      animation: "pop",
    }),
  },
  {
    id: "tiktok-bold",
    name: "TikTok bold",
    builtIn: true,
    appearance: normalizeCaptionAppearance({
      fontFamily: "Impact",
      fontSize: 38,
      color: "#FFFFFF",
      vertical: "bottom",
      horizontal: "center",
      verticalOffsetPercent: 14,
      backgroundColor: "#000000",
      backgroundOpacity: 0.55,
      outlineWidth: 0,
      shadow: 3,
      fontWeight: "bold",
      capitalization: "uppercase",
      karaokeEnabled: false,
      animation: "pop",
    }),
  },
  {
    id: "minimal-white",
    name: "Minimal white",
    builtIn: true,
    appearance: normalizeCaptionAppearance({
      fontFamily: "Arial",
      fontSize: 24,
      color: "#FFFFFF",
      vertical: "bottom",
      horizontal: "center",
      verticalOffsetPercent: 8,
      backgroundOpacity: 0,
      outlineWidth: 2,
      outlineColor: "#000000",
      shadow: 1,
      fontWeight: "normal",
      karaokeEnabled: false,
      animation: "fade",
    }),
  },
  {
    id: "neon-pop",
    name: "Neon pop",
    builtIn: true,
    appearance: normalizeCaptionAppearance({
      fontFamily: "Montserrat",
      fontSize: 32,
      color: "#95FF00",
      vertical: "bottom",
      horizontal: "center",
      verticalOffsetPercent: 12,
      backgroundColor: "#000000",
      backgroundOpacity: 0.45,
      outlineWidth: 0,
      shadow: 4,
      fontWeight: "bold",
      karaokeEnabled: false,
      highlightColor: "#FFFFFF",
      animation: "pop",
    }),
  },
  {
    id: "subtitle-classic",
    name: "Subtitle classic",
    builtIn: true,
    appearance: normalizeCaptionAppearance({
      fontFamily: "Segoe UI",
      fontSize: 22,
      color: "#FFFFFF",
      vertical: "bottom",
      horizontal: "center",
      verticalOffsetPercent: 6,
      backgroundColor: "#000000",
      backgroundOpacity: 0.65,
      outlineWidth: 0,
      shadow: 0,
      fontWeight: "normal",
      karaokeEnabled: false,
      animation: "none",
    }),
  },
  {
    id: "top-banner",
    name: "Top banner",
    builtIn: true,
    appearance: normalizeCaptionAppearance({
      fontFamily: "Roboto",
      fontSize: 26,
      color: "#FFFFFF",
      vertical: "top",
      horizontal: "center",
      verticalOffsetPercent: 10,
      backgroundColor: "#000000",
      backgroundOpacity: 0.5,
      outlineWidth: 0,
      shadow: 2,
      fontWeight: "bold",
      karaokeEnabled: false,
      animation: "slideUp",
    }),
  },
  {
    id: "karaoke-pink",
    name: "Karaoke pink",
    builtIn: true,
    appearance: normalizeCaptionAppearance({
      fontFamily: "Impact",
      fontSize: 34,
      color: "#FFFFFF",
      vertical: "bottom",
      horizontal: "center",
      verticalOffsetPercent: 13,
      backgroundColor: "#000000",
      backgroundOpacity: 0.4,
      outlineWidth: 0,
      shadow: 3,
      fontWeight: "bold",
      capitalization: "uppercase",
      karaokeEnabled: true,
      highlightColor: "#FF4D9A",
      animation: "none",
    }),
  },
];

function newPresetId(): string {
  return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function readCustomCaptionPresets(): SavedCaptionPreset[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(CAPTION_PRESETS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedCaptionPreset[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((p) => p && typeof p.id === "string" && typeof p.name === "string")
      .map((p) => ({
        id: p.id,
        name: p.name.trim().slice(0, 48) || "Untitled",
        appearance: normalizeCaptionAppearance(p.appearance),
        createdAt: typeof p.createdAt === "string" ? p.createdAt : new Date().toISOString(),
      }));
  } catch {
    return [];
  }
}

export function writeCustomCaptionPresets(presets: SavedCaptionPreset[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(CAPTION_PRESETS_STORAGE_KEY, JSON.stringify(presets));
}

export function getAllCaptionPresets(): CaptionPreset[] {
  const custom = readCustomCaptionPresets().map((p) => ({
    id: p.id,
    name: p.name,
    appearance: p.appearance,
    builtIn: false,
  }));
  return [...BUILT_IN_CAPTION_PRESETS, ...custom];
}

export function saveCustomCaptionPreset(
  name: string,
  appearance: CaptionAppearance
): SavedCaptionPreset {
  const trimmed = name.trim().slice(0, 48) || "My preset";
  const preset: SavedCaptionPreset = {
    id: newPresetId(),
    name: trimmed,
    appearance: normalizeCaptionAppearance(appearance),
    createdAt: new Date().toISOString(),
  };
  const next = [...readCustomCaptionPresets(), preset];
  writeCustomCaptionPresets(next);
  return preset;
}

export function deleteCustomCaptionPreset(id: string): void {
  const next = readCustomCaptionPresets().filter((p) => p.id !== id);
  writeCustomCaptionPresets(next);
}

export function readActiveCaptionPresetId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(CAPTION_PRESET_ID_STORAGE_KEY);
}

export function writeActiveCaptionPresetId(id: string | null): void {
  if (typeof window === "undefined") return;
  if (!id) {
    localStorage.removeItem(CAPTION_PRESET_ID_STORAGE_KEY);
    return;
  }
  localStorage.setItem(CAPTION_PRESET_ID_STORAGE_KEY, id);
}

export function findCaptionPreset(id: string): CaptionPreset | null {
  return getAllCaptionPresets().find((p) => p.id === id) ?? null;
}

/** True when manual tweaks diverge from the named preset. */
export function appearanceMatchesPreset(
  appearance: CaptionAppearance,
  preset: CaptionPreset
): boolean {
  const a = normalizeCaptionAppearance(appearance);
  const b = normalizeCaptionAppearance(preset.appearance);
  return (
    a.fontFamily === b.fontFamily &&
    a.fontSize === b.fontSize &&
    a.color === b.color &&
    a.vertical === b.vertical &&
    a.horizontal === b.horizontal &&
    a.verticalOffsetPercent === b.verticalOffsetPercent &&
    a.backgroundColor === b.backgroundColor &&
    a.backgroundOpacity === b.backgroundOpacity &&
    a.outlineWidth === b.outlineWidth &&
    a.outlineColor === b.outlineColor &&
    a.shadow === b.shadow &&
    a.fontWeight === b.fontWeight &&
    a.italic === b.italic &&
    a.capitalization === b.capitalization &&
    a.karaokeEnabled === b.karaokeEnabled &&
    a.highlightColor === b.highlightColor &&
    a.animation === b.animation
  );
}
