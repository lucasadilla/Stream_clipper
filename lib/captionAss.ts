import {
  applyCaptionCapitalization,
  assAlignment,
  hexToAssColor,
  hexToAssColorWithAlpha,
  normalizeCaptionAppearance,
  type CaptionAppearance,
} from "@/lib/captionAppearance";
import { maxCharsPerCaptionLine } from "@/lib/captionStyles";
import {
  resolveCaptionOverlaps,
  type CaptionCue,
  type CaptionWord,
} from "@/lib/captionTrack";

export interface GenerateAssOptions {
  cues: Array<
    Pick<CaptionCue, "startTimeSeconds" | "endTimeSeconds" | "text"> & {
      words?: CaptionWord[];
    }
  >;
  appearance: CaptionAppearance;
  width: number;
  height: number;
  /** Used to wrap karaoke lines like the editor (vertical ≈ 28 chars). */
  format?: "native" | "vertical";
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
  let cs = Math.round((s - Math.floor(s)) * 100);
  if (cs === 100) {
    return formatAssTime(Math.floor(s) + 1);
  }
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function toKaraokeCs(seconds: number): number {
  return Math.max(1, Math.round(Math.max(0, seconds) * 100));
}

/**
 * Entrance animations tuned to match the editor CSS.
 * Applied once per cue (not per karaoke syllable).
 */
function animationOverride(
  animation: CaptionAppearance["animation"],
  width: number,
  height: number,
  appearance: CaptionAppearance,
  fontSize: number
): string {
  switch (animation) {
    case "fade":
      return "\\fad(220,0)";
    case "pop":
      return (
        "\\fscx86\\fscy86\\alpha&HFF&" +
        "\\t(0,192,\\fscx106\\fscy106\\alpha&H00&)" +
        "\\t(192,320,\\fscx100\\fscy100)"
      );
    case "slideUp": {
      const marginV = Math.round((appearance.verticalOffsetPercent / 100) * height);
      const marginH = Math.round(width * 0.05);
      let x = width / 2;
      if (appearance.horizontal === "left") x = marginH;
      if (appearance.horizontal === "right") x = width - marginH;
      let y = height - marginV;
      if (appearance.vertical === "top") y = marginV;
      if (appearance.vertical === "center") y = height / 2;
      const fromY = Math.round(y + Math.max(12, fontSize * 0.7));
      return `\\move(${Math.round(x)},${fromY},${Math.round(x)},${Math.round(y)},0,280)\\fad(120,0)`;
    }
    default:
      return "";
  }
}

/**
 * Map the editor's soft CSS text-shadow to ASS edges.
 * Raw ASS Shadow=N is a hard opaque duplicate of every glyph ("text on text").
 * A thin outline + small blurred shadow reads much closer to the preview.
 */
function readabilityOverrides(
  app: CaptionAppearance,
  fontSize: number
): { bord: number; shad: number; blur: number; backColour: string } {
  if (app.backgroundOpacity > 0) {
    return {
      bord: Math.max(1, Math.round(fontSize * 0.14) + app.outlineWidth),
      shad: app.shadow,
      blur: 0,
      backColour: hexToAssColorWithAlpha(app.backgroundColor, app.backgroundOpacity),
    };
  }

  const bord =
    app.outlineWidth > 0
      ? app.outlineWidth
      : app.shadow > 0
        ? Math.max(2, Math.round(fontSize * 0.055))
        : 0;
  const shad =
    app.shadow > 0 ? Math.min(3, Math.max(1, Math.round(app.shadow / 2))) : 0;
  const blur = app.shadow > 0 ? 0.7 : 0;
  const backColour =
    app.shadow > 0
      ? hexToAssColorWithAlpha("#000000", 0.85)
      : hexToAssColorWithAlpha(app.backgroundColor, 0);

  return { bord, shad, blur, backColour };
}

/**
 * Karaoke body with \\k timings and soft line wraps matching the editor.
 */
function karaokeAssBody(
  words: CaptionWord[],
  cueStart: number,
  cueEnd: number,
  capitalization: CaptionAppearance["capitalization"],
  maxChars: number
): string {
  const usable = words
    .map((word) => {
      const start = Math.max(cueStart, word.start);
      const end = Math.min(cueEnd, Math.max(start, word.end));
      return { ...word, start, end };
    })
    .filter((word) => word.end > word.start && word.word.trim().length > 0);

  if (usable.length === 0) return "";

  const parts: string[] = [];
  let cursor = cueStart;
  let lineLen = 0;
  let linesUsed = 1;
  const maxLines = 2;

  for (let index = 0; index < usable.length; index++) {
    const word = usable[index]!;
    if (word.start > cursor) {
      parts.push(`{\\k${toKaraokeCs(word.start - cursor)}}`);
    }
    const piece = applyCaptionCapitalization(word.word.trim(), capitalization);
    const addLen = lineLen > 0 ? piece.length + 1 : piece.length;
    if (lineLen > 0 && linesUsed < maxLines && addLen + lineLen > maxChars) {
      parts.push("\\N");
      lineLen = 0;
      linesUsed += 1;
    }
    const spacer = index < usable.length - 1 ? " " : "";
    parts.push(
      `{\\k${toKaraokeCs(word.end - word.start)}}${escapeAssText(piece)}${spacer}`
    );
    lineLen = lineLen > 0 ? lineLen + 1 + piece.length : piece.length;
    cursor = word.end;
  }

  return parts.join("");
}

/** Build a full ASS script matching CaptionAppearance for libass burn-in. */
export function generateAss(options: GenerateAssOptions): string {
  const app = normalizeCaptionAppearance(options.appearance);
  const { width, height } = options;
  const maxChars = maxCharsPerCaptionLine(options.format ?? "vertical");

  // Editor only shows one cue; de-overlap so ASS does the same.
  const cues = resolveCaptionOverlaps(options.cues);

  const fontSize = Math.max(1, Math.round((app.fontSize * height) / 1080));
  const marginV = Math.round((app.verticalOffsetPercent / 100) * height);
  const marginH = Math.round(width * 0.05);
  const useBox = app.backgroundOpacity > 0;
  const edge = readabilityOverrides(app, fontSize);
  const alignment = assAlignment(app.vertical, app.horizontal);

  const baseColor = hexToAssColor(app.color);
  const highlightColor = hexToAssColor(app.highlightColor);
  const primary = app.karaokeEnabled ? highlightColor : baseColor;
  const secondary = baseColor;

  const styleFields = (
    name: string,
    primaryColour: string,
    secondaryColour: string
  ) =>
    [
      `Style: ${name}`,
      app.fontFamily,
      fontSize,
      primaryColour,
      secondaryColour,
      hexToAssColor(app.outlineColor),
      edge.backColour,
      app.fontWeight === "bold" ? -1 : 0,
      app.italic ? -1 : 0,
      0,
      0,
      100,
      100,
      0,
      0,
      useBox ? 3 : 1,
      edge.bord,
      edge.shad,
      alignment,
      marginH,
      marginH,
      marginV,
      1,
    ].join(",");

  const styleLine = styleFields("Default", primary, secondary);
  const plainStyleLine = app.karaokeEnabled
    ? styleFields("Plain", baseColor, baseColor)
    : null;

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

  const anim = animationOverride(app.animation, width, height, app, fontSize);
  const blurTag = edge.blur > 0 ? `\\blur${edge.blur.toFixed(2)}` : "";
  const dialogueLines: string[] = [];

  for (const cue of cues) {
    if (cue.endTimeSeconds <= cue.startTimeSeconds) continue;
    const start = formatAssTime(cue.startTimeSeconds);
    const end = formatAssTime(cue.endTimeSeconds);
    const words =
      app.karaokeEnabled && cue.words && cue.words.length > 0
        ? cue.words
        : null;

    const overrideParts = [anim, blurTag].filter(Boolean).join("");
    const override = overrideParts ? `{${overrideParts}}` : "";

    if (words) {
      const body = karaokeAssBody(
        words,
        cue.startTimeSeconds,
        cue.endTimeSeconds,
        app.capitalization,
        maxChars
      );
      if (!body) {
        const fallback = escapeAssText(
          applyCaptionCapitalization(cue.text, app.capitalization)
        );
        const style = plainStyleLine ? "Plain" : "Default";
        dialogueLines.push(
          `Dialogue: 0,${start},${end},${style},,0,0,0,,${override}${fallback}`
        );
        continue;
      }
      dialogueLines.push(
        `Dialogue: 0,${start},${end},Default,,0,0,0,,${override}${body}`
      );
      continue;
    }

    const body = escapeAssText(
      applyCaptionCapitalization(cue.text, app.capitalization)
    );
    const style = plainStyleLine ? "Plain" : "Default";
    dialogueLines.push(
      `Dialogue: 0,${start},${end},${style},,0,0,0,,${override}${body}`
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
    if (!overlay.text.trim() || overlay.endTimeSeconds <= overlay.startTimeSeconds) {
      continue;
    }
    const start = formatAssTime(overlay.startTimeSeconds);
    const end = formatAssTime(overlay.endTimeSeconds);
    const size =
      overlay.kind === "lower-third"
        ? Math.round(height * 0.048)
        : Math.round(height * 0.06);
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
    ...(plainStyleLine ? [plainStyleLine] : []),
    overlayStyleLine,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...dialogueLines,
    "",
  ].join("\n");
}
