import { z } from "zod";
import { normalizeCaptionAppearance, type CaptionAppearance } from "@/lib/captionAppearance";
import { CONTENT_LOOK_PRESET_IDS } from "@/lib/contentLookPresets";

export const brandingSchema = z.object({
  text: z.string().trim().max(60).default(""),
  position: z.enum(["top-left", "top-right", "bottom-left", "bottom-right"]).default("top-left"),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).default("#FFFFFF"),
});
export type ChannelBranding = z.infer<typeof brandingSchema>;
export const channelPresetSchema = z.object({
  name: z.string().trim().min(1).max(80),
  captionsEnabled: z.boolean(),
  captionAppearance: z.record(z.unknown()).transform((value) => normalizeCaptionAppearance(value as Partial<CaptionAppearance>)),
  look: z.enum(CONTENT_LOOK_PRESET_IDS),
  branding: brandingSchema,
  privacy: z.enum(["private", "unlisted", "public"]),
  youtubeFormat: z.enum(["shorts", "standard"]),
  instagramFormat: z.enum(["reel", "feed"]),
  facebookFormat: z.enum(["reel", "page_video"]),
  tiktokMode: z.enum(["direct", "inbox"]),
  shareToFeed: z.boolean(),
  defaultHashtags: z.array(z.string().trim().min(1).max(80)).max(20),
  captionSuffix: z.string().trim().max(300),
});
export type ChannelPreset = z.infer<typeof channelPresetSchema>;
export function defaultChannelPreset(name = "Channel style"): ChannelPreset {
  return { name, captionsEnabled: true, captionAppearance: normalizeCaptionAppearance(null), look: "auto",
    branding: { text: "", position: "top-left", color: "#FFFFFF" }, privacy: "private", youtubeFormat: "shorts",
    instagramFormat: "reel", facebookFormat: "reel", tiktokMode: "direct", shareToFeed: true, defaultHashtags: [], captionSuffix: "" };
}

/** Text is read from a UTF-8 file, never interpolated into an FFmpeg expression. */
export function brandingVideoFilter(filePath: string, branding: ChannelBranding, height: number, fontFile?: string): string {
  const escape = (value: string) => value.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
  const safePath = escape(filePath);
  const margin = Math.max(24, Math.round(height * 0.045));
  const x = branding.position.endsWith("right") ? `w-tw-${margin}` : String(margin);
  const y = branding.position.startsWith("bottom") ? `h-th-${Math.round(height * 0.2)}` : String(margin);
  return `drawtext=textfile='${safePath}'${fontFile ? `:fontfile='${escape(fontFile)}'` : ""}:expansion=none:fontcolor=${branding.color}:fontsize=${Math.round(height * 0.022)}:shadowcolor=black:shadowx=2:shadowy=2:x=${x}:y=${y}`;
}
