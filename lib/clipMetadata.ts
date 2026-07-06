import { z } from "zod";

export const clipMetadataSchema = z.object({
  title: z.string().min(1).max(100),
  description: z.string().min(1).max(300),
  hashtags: z.array(z.string().min(1).max(40)).min(3).max(10),
});

export type ClipMetadata = z.infer<typeof clipMetadataSchema>;

export function normalizeHashtag(tag: string): string {
  const cleaned = tag.trim().replace(/^#+/, "").replace(/\s+/g, "");
  return cleaned.slice(0, 40);
}

export function formatHashtags(tags: string[]): string {
  return tags
    .map(normalizeHashtag)
    .filter(Boolean)
    .map((t) => `#${t}`)
    .join(" ");
}

export function formatClipMetadataBlock(metadata: ClipMetadata): string {
  const tags = formatHashtags(metadata.hashtags);
  return `${metadata.title}\n\n${metadata.description}\n\n${tags}`;
}
