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
    description: "Facecam stacked above gameplay — classic streamer Shorts.",
    layout: "facecam_top_gameplay_bottom",
    needsFaceAnalysis: true,
    burnCaptionsDefault: true,
  },
  {
    id: "just_chatting",
    label: "Just chatting / IRL",
    description: "Face-follow vertical crop for talking-head moments.",
    layout: "subject_aware_crop",
    needsFaceAnalysis: true,
    burnCaptionsDefault: true,
  },
  {
    id: "podcast",
    label: "Podcast",
    description: "Picture-in-picture facecam over the main frame.",
    layout: "facecam_pip",
    needsFaceAnalysis: true,
    burnCaptionsDefault: true,
  },
  {
    id: "gameplay_only",
    label: "Gameplay only",
    description: "Full-frame vertical crop — no facecam panel.",
    layout: "gameplay_full",
    needsFaceAnalysis: false,
    burnCaptionsDefault: true,
  },
  {
    id: "auto",
    label: "Auto",
    description: "Let Clipper pick a layout from face detection.",
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
