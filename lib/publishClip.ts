import {
  formatClipMetadataBlock,
  formatHashtags,
  type ClipMetadata,
} from "@/lib/clipMetadata";
import type { RenderFormat } from "@/lib/renderFormat";

export type PublishDestination = "youtube" | "tiktok";

export const UPLOAD_PAGE_URLS: Record<PublishDestination, string> = {
  youtube: "https://www.youtube.com/upload",
  tiktok: "https://www.tiktok.com/upload",
};

export function formatYouTubeUploadText(
  metadata: ClipMetadata | null,
  fallbackTitle?: string
): string {
  if (!metadata) {
    return fallbackTitle?.trim() || "";
  }
  const tags = formatHashtags(metadata.hashtags);
  return [metadata.title, "", metadata.description, tags ? `\n${tags}` : ""]
    .filter((line, i, arr) => line !== "" || (i > 0 && arr[i - 1] !== ""))
    .join("\n")
    .trim();
}

/** TikTok uses a single caption field — title + description + tags. */
export function formatTikTokUploadText(
  metadata: ClipMetadata | null,
  fallbackTitle?: string
): string {
  if (!metadata) {
    return fallbackTitle?.trim() || "";
  }
  const tags = formatHashtags(metadata.hashtags);
  return [metadata.title, metadata.description, tags]
    .filter(Boolean)
    .join("\n\n")
    .trim()
    .slice(0, 2200);
}

export function clipboardTextForDestination(
  destination: PublishDestination,
  metadata: ClipMetadata | null,
  fallbackTitle?: string
): string {
  if (destination === "tiktok") {
    return formatTikTokUploadText(metadata, fallbackTitle);
  }
  return formatYouTubeUploadText(metadata, fallbackTitle);
}

export function openUploadPage(destination: PublishDestination): void {
  window.open(UPLOAD_PAGE_URLS[destination], "_blank", "noopener,noreferrer");
}

export async function copyToClipboard(text: string): Promise<void> {
  if (!text.trim()) return;
  await navigator.clipboard.writeText(text);
}

/** Copy upload copy + open the platform upload page (no API upload). */
export async function publishHalfStep(
  destination: PublishDestination,
  metadata: ClipMetadata | null,
  fallbackTitle?: string
): Promise<{ copied: string; destination: PublishDestination }> {
  const copied = clipboardTextForDestination(destination, metadata, fallbackTitle);
  if (copied) {
    await copyToClipboard(copied);
  }
  openUploadPage(destination);
  return { copied, destination };
}

export function suggestedDestinations(
  format: RenderFormat
): PublishDestination[] {
  if (format === "vertical") return ["youtube", "tiktok"];
  return ["youtube"];
}

export function destinationLabel(destination: PublishDestination): string {
  if (destination === "youtube") return "YouTube";
  return "TikTok";
}

export function destinationHint(
  destination: PublishDestination,
  format: RenderFormat
): string {
  if (destination === "youtube") {
    return format === "vertical"
      ? "Opens YouTube upload — paste as title & description for your Short"
      : "Opens YouTube upload — paste title & description";
  }
  return "Opens TikTok upload — paste into the caption field";
}

/** Full block for manual copy when user has not generated AI metadata. */
export function fallbackUploadBlock(title: string, format: RenderFormat): string {
  const label = format === "vertical" ? "Short" : "clip";
  return `${title || `My stream ${label}`}\n\nClip exported from Stream Clipper.`;
}

export { formatClipMetadataBlock };
