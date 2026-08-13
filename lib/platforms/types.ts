export type PlatformKey =
  | "youtube_shorts"
  | "youtube_landscape"
  | "tiktok"
  | "instagram_reels"
  | "instagram_feed"
  | "facebook_reels"
  | "facebook_feed"
  | "x";

export type XQuoteLayout = "quote_top" | "quote_bottom" | "overlay";

export interface PlatformOutputOption {
  id: string;
  label: string;
  width: number;
  height: number;
  aspectRatio: string;
}

export interface PlatformPreset {
  key: PlatformKey;
  name: string;
  description: string;
  outputs: PlatformOutputOption[];
  recommendedDuration?: { min: number; max: number };
  hardDuration?: { min?: number; max?: number };
  titleLimit?: number;
  captionLimit?: number;
  postTextLimit?: number;
  hashtagRange?: { min: number; max: number; hardMax?: number };
  maxFileSizeBytes?: number;
  supportsQuoteCard?: boolean;
}

export interface PlatformCopy {
  title: string | null;
  caption: string | null;
  postText: string | null;
  description: string | null;
  hashtags: string[];
  tags: string[];
  quoteText: string | null;
  thumbnailText: string | null;
  pinnedComment: string | null;
}

export interface PlatformExportSettings {
  outputId: string;
  width: number;
  height: number;
  aspectRatio: string;
  includeCaptions: boolean;
  burnSubtitles: boolean;
  generateCopy: boolean;
  /** Preserve user-approved copy supplied when the export pack was created. */
  useCopyOverride?: boolean;
  xQuoteCard: boolean;
  xQuoteLayout: XQuoteLayout;
}

export interface CreatePlatformExportPackInput {
  platforms: PlatformKey[];
  includeCaptions: boolean;
  burnSubtitles: boolean;
  generateCopy: boolean;
  xQuoteCard: boolean;
  xQuoteLayout?: XQuoteLayout;
  outputOptions?: Partial<Record<PlatformKey, string>>;
  copyOverrides?: Partial<Record<PlatformKey, PlatformCopy>>;
}

export interface PlatformValidationInput {
  platform: PlatformKey;
  width: number;
  height: number;
  durationSeconds: number;
  fileSizeBytes: number;
  format?: string | null;
  videoCodec?: string | null;
  audioCodec?: string | null;
  copy: PlatformCopy;
}
