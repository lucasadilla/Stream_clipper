import {
  applyCaptionCapitalization,
  assAlignment,
  hexToAssColor,
  hexToAssColorWithAlpha,
  normalizeCaptionAppearance,
  type CaptionAppearance,
} from "@/lib/captionAppearance";
import type { CaptionCue, CaptionWord } from "@/lib/captionTrack";

export interface GenerateAssOptions {
  cues: Array<
    Pick<CaptionCue, "startTimeSeconds" | "endTimeSeconds" | "text"> & {
      words?: CaptionWord[];
    }
  >;
  appearance: CaptionAppearance;
  width: number;
  height: number;
  overlays?: Array<{
    startTimeSeconds: number;
    endTimeSeconds: number;
    text: string;
    kind: "text" | "lower-third";
    position: "center" | "top-left" | "top-right" | "bottom-left" | "bottom-right";
  }>;
}

function escapeAssText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\n/g, "\\N");
}

function formatAssTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const cs = Math.round((s - Math.floor(s)) * 100);
  const csClamped = cs === 100 ? 99 : cs;
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(csClamped).padStart(2, "0")}`;
}

function animationOverride(
  animation: CaptionAppearance["animation"],
  width: number,
  height: number,
  appearance: CaptionAppearance
): string {
  switch (animation) {
    case "fade":
      return "\\fad(180,120)";
    case "pop":
      return "\\fscx100\\fscy100\\t(0,160,\\fscx118\\fscy118)\\t(160,280,\\fscx100\\fscy100)";
    case "slideUp": {
      const marginV = Math.round((appearance.verticalOffsetPercent / 100) * height);
      const marginH = Math.round(width * 0.05);
      let x = width / 2;
      if (appearance.horizontal === "left") x = marginH;
      if (appearance.horizontal === "right") x = width - marginH;
      let y = height - marginV;
      if (appearance.vertical === "top") y = marginV;
      if (appearance.vertical === "center") y = height / 2;
      const fromY = Math.round(y + Math.max(24, height * 0.03));
      return `\\move(${Math.round(x)},${fromY},${Math.round(x)},${Math.round(y)},0,280)`;
    }
    default:
      return "";
  }
}

function karaokeText(
  words: CaptionWord[],
  cueStart: number,
  capitalization: CaptionAppearance["capitalization"]
): string {
  const parts: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    const next = words[i + 1];
    const start = Math.max(cueStart, word.start);
    const end = next ? Math.max(start, Math.min(word.end, next.start)) : Math.max(start, word.end);
    const centis = Math.max(1, Math.round((end - start) * 100));
    const piece = applyCaptionCapitalization(word.word.trim(), capitalization);
    if (!piece) continue;
    const spacer = i < words.length - 1 ? " " : "";
    parts.push(`{\\k${centis}}${escapeAssText(piece)}${spacer}`);
  }
  return parts.join("");
}

/** Build a full ASS script matching CaptionAppearance for libass burn-in. */
export function generateAss(options: GenerateAssOptions): string {
  const app = normalizeCaptionAppearance(options.appearance);
  const { width, height, cues } = options;

  const fontSize = Math.max(1, Math.round((app.fontSize * height) / 1080));
  const marginV = Math.round((app.verticalOffsetPercent / 100) * height);
  const marginH = Math.round(width * 0.05);
  const useBox = app.backgroundOpacity > 0;
  const outline = useBox
    ? Math.max(1, Math.round(fontSize * 0.14) + app.outlineWidth)
    : app.outlineWidth;
  const alignment = assAlignment(app.vertical, app.horizontal);
  const primary = app.karaokeEnabled
    ? hexToAssColor(app.highlightColor)
    : hexToAssColor(app.color);
  const secondary = app.karaokeEnabled
    ? hexToAssColor(app.color)
    : hexToAssColor(app.color);

  const styleLine = [
    "Style: Default",
    app.fontFamily,
    fontSize,
    primary,
    secondary,
    hexToAssColor(app.outlineColor),
    hexToAssColorWithAlpha(app.backgroundColor, app.backgroundOpacity),
    app.fontWeight === "bold" ? -1 : 0,
    app.italic ? -1 : 0,
    0, // Underline
    0, // StrikeOut
    100, // ScaleX
    100, // ScaleY
    0, // Spacing
    0, // Angle
    useBox ? 3 : 1,
    outline,
    app.shadow,
    alignment,
    marginH,
    marginH,
    marginV,
    1, // Encoding
  ].join(",");

  const overlayStyleLine = [
    "Style: Overlay",
    "Arial",
    Math.max(24, Math.round(height * 0.052)),
    "&H00FFFFFF",
    "&H00FFFFFF",
    "&H00000000",
    "&H78000000",
    -1,
    0,
    0,
    0,
    100,
    100,
    0,
    0,
    3,
    Math.max(2, Math.round(height * 0.004)),
    0,
    2,
    Math.round(width * 0.05),
    Math.round(width * 0.05),
    Math.round(height * 0.08),
    1,
  ].join(",");

  const anim = animationOverride(app.animation, width, height, app);
  const dialogueLines: string[] = [];

  for (const cue of cues) {
    if (cue.endTimeSeconds <= cue.startTimeSeconds) continue;
    const start = formatAssTime(cue.startTimeSeconds);
    const end = formatAssTime(cue.endTimeSeconds);
    const words =
      app.karaokeEnabled && cue.words && cue.words.length > 0
        ? cue.words
        : null;

    let body: string;
    if (words) {
      body = karaokeText(words, cue.startTimeSeconds, app.capitalization);
    } else {
      body = escapeAssText(
        applyCaptionCapitalization(cue.text, app.capitalization)
      );
    }

    const override = anim ? `{${anim}}` : "";
    dialogueLines.push(
      `Dialogue: 0,${start},${end},Default,,0,0,0,,${override}${body}`
    );
  }

  const alignmentForPosition = (
    position: "center" | "top-left" | "top-right" | "bottom-left" | "bottom-right"
  ) => {
    switch (position) {
      case "top-left":
        return 7;
      case "top-right":
        return 9;
      case "bottom-left":
        return 1;
      case "bottom-right":
        return 3;
      default:
        return 5;
    }
  };

  for (const overlay of options.overlays ?? []) {
    if (!overlay.text.trim() || overlay.endTimeSeconds <= overlay.startTimeSeconds) continue;
    const start = formatAssTime(overlay.startTimeSeconds);
    const end = formatAssTime(overlay.endTimeSeconds);
    const size = overlay.kind === "lower-third" ? Math.round(height * 0.048) : Math.round(height * 0.06);
    const align = alignmentForPosition(overlay.position);
    const body = escapeAssText(overlay.text.trim());
    dialogueLines.push(
      `Dialogue: 1,${start},${end},Overlay,,0,0,0,,{\\an${align}\\fs${size}\\fad(120,120)}${body}`
    );
  }

  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    `PlayResX: ${Math.round(width)}`,
    `PlayResY: ${Math.round(height)}`,
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    styleLine,
    overlayStyleLine,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...dialogueLines,
    "",
  ].join("\n");
}
