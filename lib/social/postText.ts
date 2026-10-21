import type { SocialGeneratedContent } from "./types";

export function socialCaption(content: SocialGeneratedContent): string {
  const text = (content.caption || content.postText || content.title).trim();
  const present = new Set((text.match(/#[\p{L}\p{N}_]+/gu) || []).map((tag) => tag.toLowerCase()));
  const missing = Array.from(new Set(content.hashtags.map((tag) => `#${tag.replace(/^#+/, "").trim()}`).filter((tag) => /^#[\p{L}\p{N}_]+$/u.test(tag))))
    .filter((tag) => !present.has(tag.toLowerCase()));
  return [text, missing.join(" ")].filter(Boolean).join("\n\n");
}
