import type { VerticalLayout } from "@/lib/verticalLayout";

export const CONTENT_LOOK_PRESET_IDS = [
  "gaming",
  "just_chatting",
  "podcast",
  "gameplay_only",
  "auto",
] as const;

export type ContentLookPresetId = (typeof CONTENT_LOOK_PRESET_IDS)[number];

export interface ContentLookPreset {
  id: ContentLookPresetId;
  label: string;
  /** Plain-language explanation of what the crop does. */
  behavior: string;
  description: string;
  layout: VerticalLayout;
  /** Prefer face analysis before render. */
  needsFaceAnalysis: boolean;
  burnCaptionsDefault: boolean;
}

export const CONTENT_LOOK_PRESETS: ContentLookPreset[] = [
  {
    id: "gaming",
    label: "Gaming",
    behavior: "Face on top, gameplay below",
    description: "Keeps reactions visible without covering the action.",
    layout: "facecam_top_gameplay_bottom",
    needsFaceAnalysis: true,
    burnCaptionsDefault: true,
  },
  {
    id: "just_chatting",
    label: "Just chatting / IRL",
    behavior: "Follows whoever is speaking",
    description:
      "Tracks the active speaker, holds on one person, or centers safely when no face is found.",
    layout: "subject_aware_crop",
    needsFaceAnalysis: true,
    burnCaptionsDefault: true,
  },
  {
    id: "podcast",
    label: "Podcast",
    behavior: "Speaker inset over the full scene",
    description: "Keeps conversation context visible behind a focused face.",
    layout: "facecam_pip",
    needsFaceAnalysis: true,
    burnCaptionsDefault: true,
  },
  {
    id: "gameplay_only",
    label: "Gameplay only",
    behavior: "Gameplay fills the vertical frame",
    description: "Uses the full screen and leaves out facecam framing.",
    layout: "gameplay_full",
    needsFaceAnalysis: false,
    burnCaptionsDefault: true,
  },
  {
    id: "auto",
    label: "Auto Look",
    behavior: "Clipper chooses the best composition",
    description: "Uses detected faces and clip type to select a layout.",
    layout: "auto",
    needsFaceAnalysis: true,
    burnCaptionsDefault: true,
  },
];

export function getContentLookPreset(
  id: string | null | undefined
): ContentLookPreset {
  return (
    CONTENT_LOOK_PRESETS.find((p) => p.id === id) ??
    CONTENT_LOOK_PRESETS.find((p) => p.id === "auto")!
  );
}

export function isContentLookPresetId(value: unknown): value is ContentLookPresetId {
  return (
    typeof value === "string" &&
    (CONTENT_LOOK_PRESET_IDS as readonly string[]).includes(value)
  );
}

/** Map a resolved vertical layout back to the closest agent look preset. */
export function lookPresetFromLayout(
  layout: string | null | undefined
): ContentLookPresetId {
  switch (layout) {
    case "facecam_top_gameplay_bottom":
    case "facecam_bottom_gameplay_top":
      return "gaming";
    case "facecam_pip":
    case "facecam_overlay":
      return "podcast";
    case "subject_aware_crop":
      return "just_chatting";
    case "gameplay_full":
      return "gameplay_only";
    default:
      return "auto";
  }
}
