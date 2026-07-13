import type {
  PlatformExportSettings,
  PlatformKey,
  PlatformPreset,
  XQuoteLayout,
} from "@/lib/platforms/types";

const MB = 1024 * 1024;

export const PLATFORM_PRESETS: Record<PlatformKey, PlatformPreset> = {
  youtube_shorts: {
    key: "youtube_shorts",
    name: "YouTube Shorts",
    description: "Vertical discovery cut with searchable title and Shorts-ready copy.",
    outputs: [{ id: "vertical", label: "9:16", width: 1080, height: 1920, aspectRatio: "9:16" }],
    recommendedDuration: { min: 15, max: 60 },
    hardDuration: { max: 180 },
    titleLimit: 100,
    hashtagRange: { min: 3, max: 5 },
  },
  youtube_landscape: {
    key: "youtube_landscape",
    name: "YouTube Landscape",
    description: "Full-width YouTube highlight with SEO title, description, and tags.",
    outputs: [{ id: "landscape", label: "16:9", width: 1920, height: 1080, aspectRatio: "16:9" }],
    titleLimit: 100,
  },
  tiktok: {
    key: "tiktok",
    name: "TikTok",
    description: "Fast vertical cut with a creator-native hook and concise caption.",
    outputs: [{ id: "vertical", label: "9:16", width: 1080, height: 1920, aspectRatio: "9:16" }],
    recommendedDuration: { min: 15, max: 45 },
    hardDuration: { min: 3, max: 600 },
    captionLimit: 2200,
    hashtagRange: { min: 3, max: 8 },
  },
  instagram_reels: {
    key: "instagram_reels",
    name: "Instagram Reels",
    description: "Vertical Reel with hook-first caption and interface-safe framing.",
    outputs: [{ id: "vertical", label: "9:16", width: 1080, height: 1920, aspectRatio: "9:16" }],
    recommendedDuration: { min: 15, max: 90 },
    captionLimit: 2200,
    hashtagRange: { min: 3, max: 8, hardMax: 30 },
  },
  instagram_feed: {
    key: "instagram_feed",
    name: "Instagram Feed",
    description: "Portrait or square feed post with polished contextual copy.",
    outputs: [
      { id: "portrait", label: "4:5", width: 1080, height: 1350, aspectRatio: "4:5" },
      { id: "square", label: "1:1", width: 1080, height: 1080, aspectRatio: "1:1" },
    ],
    captionLimit: 2200,
    hashtagRange: { min: 3, max: 8, hardMax: 30 },
  },
  facebook_reels: {
    key: "facebook_reels",
    name: "Facebook Reels",
    description: "Vertical Reel with a broad-audience hook and clean caption.",
    outputs: [{ id: "vertical", label: "9:16", width: 1080, height: 1920, aspectRatio: "9:16" }],
    recommendedDuration: { min: 15, max: 90 },
  },
  facebook_feed: {
    key: "facebook_feed",
    name: "Facebook Feed",
    description: "Feed-ready video with conversational copy and a discussion prompt.",
    outputs: [
      { id: "portrait", label: "4:5", width: 1440, height: 1800, aspectRatio: "4:5" },
      { id: "landscape", label: "16:9", width: 1920, height: 1080, aspectRatio: "16:9" },
      { id: "square", label: "1:1", width: 1080, height: 1080, aspectRatio: "1:1" },
    ],
    maxFileSizeBytes: 4 * 1024 * MB,
  },
  x: {
    key: "x",
    name: "X / Twitter",
    description: "Landscape or vertical post with concise copy and optional quote-card treatment.",
    outputs: [
      { id: "landscape", label: "16:9", width: 1920, height: 1080, aspectRatio: "16:9" },
      { id: "vertical", label: "9:16", width: 1080, height: 1920, aspectRatio: "9:16" },
    ],
    hardDuration: { max: 140 },
    postTextLimit: 280,
    hashtagRange: { min: 0, max: 2 },
    maxFileSizeBytes: 512 * MB,
    supportsQuoteCard: true,
  },
};

export const PLATFORM_KEYS = Object.keys(PLATFORM_PRESETS) as PlatformKey[];

export function isPlatformKey(value: unknown): value is PlatformKey {
  return typeof value === "string" && value in PLATFORM_PRESETS;
}

export function platformSettings(
  platform: PlatformKey,
  options: {
    outputId?: string;
    includeCaptions: boolean;
    burnSubtitles: boolean;
    generateCopy: boolean;
    xQuoteCard: boolean;
    xQuoteLayout?: XQuoteLayout;
  }
): PlatformExportSettings {
  const preset = PLATFORM_PRESETS[platform];
  const output =
    preset.outputs.find((item) => item.id === options.outputId) ?? preset.outputs[0]!;
  return {
    outputId: output.id,
    width: output.width,
    height: output.height,
    aspectRatio: output.aspectRatio,
    includeCaptions: options.includeCaptions,
    burnSubtitles: options.burnSubtitles,
    generateCopy: options.generateCopy,
    xQuoteCard: platform === "x" && options.xQuoteCard,
    xQuoteLayout: options.xQuoteLayout ?? "quote_top",
  };
}
