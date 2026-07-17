import type {
  EmojiLevel,
  HashtagLevel,
  SocialContentTone,
} from "@/lib/social/types";

export type PublishingPreferencesView = {
  id: string | null;
  autoCreateReviewDraft: boolean;
  defaultPrivacy: "private" | "unlisted" | "public";
  tone: SocialContentTone;
  emojiLevel: EmojiLevel;
  hashtagLevel: HashtagLevel;
  includeSourceUrl: boolean;
  useTranscriptQuotes: boolean;
  defaultHashtags: string[];
  defaultAccountIds: string[];
  youtubeFormat: "shorts" | "standard";
  facebookFormat: "reel" | "page_video";
  tiktokMode: "direct" | "inbox";
};

export function defaultPublishingPreferences(): PublishingPreferencesView {
  return {
    id: null,
    autoCreateReviewDraft: false,
    defaultPrivacy: "private",
    tone: "natural",
    emojiLevel: "low",
    hashtagLevel: "minimal",
    includeSourceUrl: true,
    useTranscriptQuotes: true,
    defaultHashtags: [],
    defaultAccountIds: [],
    youtubeFormat: "shorts",
    facebookFormat: "reel",
    tiktokMode: "direct",
  };
}
