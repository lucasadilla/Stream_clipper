import type { RenderFormat } from "@/lib/renderFormat";

const PLACEHOLDER_RE =
  /^\[Live \d+s|placeholder|connect Whisper|\[silence\]|\[processing error\]/i;
const PUNCTUATION_ONLY_RE = /^[\s.…,;:!?'"()[\]{}<>_-]+$/u;

export interface CaptionChunk {
  startTimeSeconds: number;
  endTimeSeconds: number;
  text: string;
}

/** Max characters per line before wrapping (fits safe area in each format). */
export function maxCharsPerCaptionLine(format: RenderFormat): number {
  return format === "vertical" ? 28 : 44;
}

export function isValidCaptionText(text: string): boolean {
  const t = sanitizeCaptionText(text);
  return (
    t.length > 0 &&
    !PLACEHOLDER_RE.test(t) &&
    !PUNCTUATION_ONLY_RE.test(t)
  );
}

/** Remove model pause placeholders without damaging punctuation in real words. */
export function sanitizeCaptionText(text: string): string {
  return text
    .replace(/(^|\s)(?:\.{3,}|…+)(?=\s|$)/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function wrapCaptionText(text: string, maxChars: number, maxLines = 2): string {
  const words = sanitizeCaptionText(text).split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";

  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > maxChars && line) {
      lines.push(line);
      line = word;
      if (lines.length >= maxLines) break;
    } else {
      line = candidate;
    }
  }

  if (lines.length < maxLines && line) lines.push(line);
  return lines.slice(0, maxLines).join("\n");
}

export function formatCaptionTextForBurn(
  text: string,
  format: RenderFormat
): string {
  return wrapCaptionText(text, maxCharsPerCaptionLine(format));
}

export const CAPTIONS_STORAGE_KEY = "stream-clipper-captions-enabled";

export function readCaptionsEnabledPreference(): boolean {
  if (typeof window === "undefined") return true;
  return localStorage.getItem(CAPTIONS_STORAGE_KEY) !== "false";
}

export function writeCaptionsEnabledPreference(enabled: boolean): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(CAPTIONS_STORAGE_KEY, enabled ? "true" : "false");
}
