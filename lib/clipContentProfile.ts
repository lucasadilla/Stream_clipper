export type ClipContentType =
  | "gaming"
  | "podcast"
  | "talking"
  | "gameplay_only"
  | "general";

export type ClipContentProfile = {
  type: ClipContentType;
  targetMinSeconds: number;
  targetMaxSeconds: number;
  eventWeight: number;
  audioWeight: number;
  transcriptWeight: number;
};

const PROFILES: Record<ClipContentType, ClipContentProfile> = {
  gaming: {
    type: "gaming",
    targetMinSeconds: 18,
    targetMaxSeconds: 45,
    eventWeight: 30,
    audioWeight: 26,
    transcriptWeight: 8,
  },
  podcast: {
    type: "podcast",
    targetMinSeconds: 30,
    targetMaxSeconds: 60,
    eventWeight: 12,
    audioWeight: 4,
    transcriptWeight: 28,
  },
  talking: {
    type: "talking",
    targetMinSeconds: 24,
    targetMaxSeconds: 58,
    eventWeight: 16,
    audioWeight: 8,
    transcriptWeight: 24,
  },
  gameplay_only: {
    type: "gameplay_only",
    targetMinSeconds: 15,
    targetMaxSeconds: 40,
    eventWeight: 28,
    audioWeight: 24,
    transcriptWeight: 4,
  },
  general: {
    type: "general",
    targetMinSeconds: 20,
    targetMaxSeconds: 55,
    eventWeight: 25,
    audioWeight: 18,
    transcriptWeight: 10,
  },
};

const PODCAST_TERMS =
  /\b(podcast|interview|episode|guest|roundtable|panel|conversation|debate|q\s*&\s*a)\b/i;
const GAMING_TERMS =
  /\b(gaming|gameplay|ranked|speedrun|playthrough|walkthrough|valorant|fortnite|minecraft|roblox|overwatch|elden ring|dead by daylight|marvel rivals|warzone|apex|league of legends|rocket league)\b/i;
const TALKING_TERMS =
  /\b(just chatting|ama|storytime|advice|explained|commentary|reaction|irl|talking)\b/i;
const NO_CAMERA_TERMS =
  /\b(no cam|no webcam|gameplay only|longplay)\b/i;

export function inferClipContentType(input: {
  title?: string | null;
  description?: string | null;
  transcript?: string | null;
}): ClipContentType {
  const metadata = `${input.title ?? ""} ${input.description ?? ""}`;
  const sample = `${metadata} ${(input.transcript ?? "").slice(0, 4000)}`;

  if (NO_CAMERA_TERMS.test(metadata)) return "gameplay_only";
  if (PODCAST_TERMS.test(sample)) return "podcast";
  if (GAMING_TERMS.test(sample)) return "gaming";
  if (TALKING_TERMS.test(sample)) return "talking";
  return "general";
}

export function getClipContentProfile(
  type: ClipContentType
): ClipContentProfile {
  return PROFILES[type];
}

export function contentTypeFromVisualClassification(
  classification: string
): ClipContentType {
  switch (classification) {
    case "multiple_faces":
      return "podcast";
    case "embedded_facecam":
      return "gaming";
    case "moving_subject":
      return "talking";
    case "no_face":
      return "gameplay_only";
    default:
      return "general";
  }
}
