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
  if (words.join(" ").length <= maxChars) return words.join(" ");

  if (maxLines === 2 && words.length > 1) {
    let bestSplit = 1;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let split = 1; split < words.length; split += 1) {
      const firstLength = words.slice(0, split).join(" ").length;
      const secondLength = words.slice(split).join(" ").length;
      const overflow =
        Math.max(0, firstLength - maxChars) +
        Math.max(0, secondLength - maxChars);
      const imbalance = Math.abs(firstLength - secondLength);
      const score = overflow * 100 + imbalance;
      if (score < bestScore) {
        bestScore = score;
        bestSplit = split;
      }
    }
    const first = words.slice(0, bestSplit).join(" ");
    const second = words.slice(bestSplit).join(" ");
    if (first.length <= maxChars && second.length <= maxChars) {
      return `${first}\n${second}`;
    }
  }

  const lines: string[] = [];
  let line = "";

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!;
    if (lines.length === maxLines - 1) {
      line = [line, ...words.slice(index)].filter(Boolean).join(" ");
      break;
    }
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }

  if (lines.length < maxLines && line) lines.push(line);
  return lines.join("\n");
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
