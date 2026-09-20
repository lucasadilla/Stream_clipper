import {
  applyCaptionCapitalization,
  assAlignment,
  hexToAssColor,
  hexToAssColorWithAlpha,
  normalizeCaptionAppearance,
  type CaptionAppearance,
} from "@/lib/captionAppearance";
import {
  isValidCaptionText,
  maxCharsPerCaptionLine,
  sanitizeCaptionText,
} from "@/lib/captionStyles";
import {
  captionWordsForAnimation,
  resolveCaptionOverlaps,
  type CaptionCue,
  type CaptionWord,
} from "@/lib/captionTrack";
import {
  effectiveCaptionAnimation,
  type CaptionCueDirection,
} from "@/lib/captionDirector";

export interface GenerateAssOptions {
  cues: Array<
    Pick<CaptionCue, "startTimeSeconds" | "endTimeSeconds" | "text"> & {
      words?: CaptionWord[];
      direction?: CaptionCueDirection;
    }
  >;
  appearance: CaptionAppearance;
  width: number;
  height: number;
  /** Used to wrap karaoke lines like the editor (vertical ≈ 28 chars). */
  format?: "native" | "vertical";
  /**
   * `precise` (final burns): snap glyphs to transcript timestamps — no entrance
   * fades, no 140ms word-reveal lag, and no invented karaoke timing.
   * `stylized` (editor preview parity): keeps decorative motion.
   */
  syncMode?: "precise" | "stylized";
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

function formatAssTime(seconds: number, mode: "start" | "end" = "start"): string {
  const s = Math.max(0, seconds);
  // Prefer early starts / late ends so rounding never hides spoken words.
  const totalCs =
    mode === "end" ? Math.ceil(s * 100 - 1e-9) : Math.floor(s * 100 + 1e-9);
  const h = Math.floor(totalCs / 360000);
  const m = Math.floor((totalCs % 360000) / 6000);
  const sec = Math.floor((totalCs % 6000) / 100);
  const cs = totalCs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function captionAnimationOverride(
  animation: CaptionAppearance["animation"],
  options: {
    width: number;
    height: number;
    alignment: number;
    marginH: number;
    marginV: number;
    fontSize: number;
    restingBlur: number;
  }
): string {
  if (animation === "fade") return "\\fad(260,0)";
  if (animation === "focus") {
    return `\\blur4\\alpha&H66&\\t(0,300,\\blur${options.restingBlur.toFixed(2)}\\alpha&H00&)`;
  }
  if (animation !== "rise") return "";

  const horizontal = options.alignment % 3;
  const x =
    horizontal === 1
      ? options.marginH
      : horizontal === 2
        ? Math.round(options.width / 2)
        : options.width - options.marginH;
  const row = Math.ceil(options.alignment / 3);
  const y =
    row === 3
      ? options.marginV
      : row === 2
        ? Math.round(options.height / 2)
        : options.height - options.marginV;
  const entranceOffset = Math.max(8, Math.round(options.fontSize * 0.22));
  return `\\move(${x},${y + entranceOffset},${x},${y},0,280)\\fad(120,0)`;
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
 * Timed word body matching the editor's word-reveal animation.
 */
function timedWordAssBody(
  words: CaptionWord[],
  cueStart: number,
  cueEnd: number,
  capitalization: CaptionAppearance["capitalization"],
  maxChars: number,
  baseColor: string,
  highlightColor: string,
  karaokeEnabled: boolean,
  wordReveal: boolean,
  restingBlur: number,
  preciseSync = false
): string {
  const usable = words
    .map((word) => {
      const start = Math.max(cueStart, word.start);
      const end = Math.min(cueEnd, Math.max(start, word.end));
      return { ...word, start, end };
    })
    .filter((word) => word.end > word.start && word.word.trim().length > 0);

  if (usable.length === 0) return "";

  const toMs = (seconds: number) =>
    Math.max(0, Math.round((seconds - cueStart) * 1000));

  const parts: string[] = [];
  let lineLen = 0;
  let linesUsed = 1;
  const maxLines = 2;

  for (let index = 0; index < usable.length; index++) {
    const word = usable[index]!;
    const piece = applyCaptionCapitalization(word.word.trim(), capitalization);
    const addLen = lineLen > 0 ? piece.length + 1 : piece.length;
    if (lineLen > 0 && linesUsed < maxLines && addLen + lineLen > maxChars) {
      parts.push("\\N");
      lineLen = 0;
      linesUsed += 1;
    }
    const spacer = index < usable.length - 1 ? " " : "";
    const startMs = toMs(word.start);
    const endMs = Math.max(startMs + 1, toMs(word.end));
    const timedColor = karaokeEnabled
      ? `\\t(${startMs},${startMs},\\c${highlightColor}&)\\t(${endMs},${endMs},\\c${baseColor}&)`
      : "";
    // Precise burns snap visible on the spoken timestamp. Stylized preview
    // keeps a short fade so motion still matches the editor.
    const reveal = wordReveal
      ? preciseSync
        ? `\\alpha&HFF&\\t(${startMs},${startMs},\\alpha&H00&)`
        : `\\alpha&HFF&\\blur2\\t(${startMs},${startMs + 140},\\alpha&H00&\\blur${restingBlur.toFixed(2)})`
      : "";
    parts.push(
      `{\\c${baseColor}&${reveal}${timedColor}}${escapeAssText(piece)}${spacer}`
    );
    lineLen = lineLen > 0 ? lineLen + 1 + piece.length : piece.length;
  }

  return parts.join("");
}

/** Build a full ASS script matching CaptionAppearance for libass burn-in. */
export function generateAss(options: GenerateAssOptions): string {
  const app = normalizeCaptionAppearance(options.appearance);
  const { width, height } = options;
  const maxChars = maxCharsPerCaptionLine(options.format ?? "vertical");

  // Clean client-edited cues too, not only transcript-built cues. This keeps
  // punctuation-only Whisper pauses out of the final burned captions.
  const cues = resolveCaptionOverlaps(
    options.cues.flatMap((cue) => {
      const text = sanitizeCaptionText(cue.text);
      if (!isValidCaptionText(text)) return [];
      const words = cue.words
        ?.flatMap((word) => {
          const cleanWord = sanitizeCaptionText(word.word);
          return isValidCaptionText(cleanWord)
            ? [{ ...word, word: cleanWord }]
            : [];
        });
      return [{ ...cue, text, words }];
    })
  );

  const fontSize = Math.max(1, Math.round((app.fontSize * height) / 1080));
  const useBox = app.backgroundOpacity > 0;
  const edge = readabilityOverrides(app, fontSize);
  const requestedMarginV = Math.round(
    (app.verticalOffsetPercent / 100) * height
  );
  // libass clips scaled text at the video boundary. Reserve the same kind of
  // safety gutter as the live preview when an entrance animation is enabled.
  const animationMarginV =
    app.animation === "none"
      ? 0
      : Math.ceil(fontSize * 0.14 + edge.bord + edge.shad);
  const marginV = Math.max(requestedMarginV, animationMarginV);
  const marginH = Math.round(width * 0.05);
  const alignment = assAlignment(app.vertical, app.horizontal);

  const baseColor = hexToAssColor(app.color);
  const highlightColor = hexToAssColor(app.highlightColor);
  const primary = baseColor;
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

  const blurTag = edge.blur > 0 ? `\\blur${edge.blur.toFixed(2)}` : "";
  const dialogueLines: string[] = [];

  const preciseSync = options.syncMode === "precise";

  for (const cue of cues) {
    if (cue.endTimeSeconds <= cue.startTimeSeconds) continue;
    const start = formatAssTime(cue.startTimeSeconds, "start");
    const end = formatAssTime(cue.endTimeSeconds, "end");
    const sourceAnimation = effectiveCaptionAnimation(cue, app.animation);
    // Suppress decorative entrance motion on final burns, but keep the
    // source animation so word-reveal / karaoke still fire on STT timings.
    const animationTag = preciseSync
      ? ""
      : captionAnimationOverride(sourceAnimation, {
          width,
          height,
          alignment,
          marginH,
          marginV,
          fontSize,
          restingBlur: edge.blur,
        });
    const wantsWordTiming =
      sourceAnimation === "wordReveal" || app.karaokeEnabled;
    const hasAuthoritativeWords = (cue.words ?? []).some(
      (word) =>
        Number.isFinite(word.start) &&
        Number.isFinite(word.end) &&
        word.end > word.start &&
        word.word.trim().length > 0
    );
    // Invented proportional word times look late/early on final exports.
    // Only burn word-level effects when STT supplied real words, or when
    // stylized preview wants estimated karaoke.
    const words =
      wantsWordTiming && (!preciseSync || hasAuthoritativeWords)
        ? captionWordsForAnimation(cue)
        : null;

    const overrideParts = [blurTag, animationTag].filter(Boolean).join("");
    const override = overrideParts ? `{${overrideParts}}` : "";

    if (words) {
      const body = timedWordAssBody(
        words,
        cue.startTimeSeconds,
        cue.endTimeSeconds,
        app.capitalization,
        maxChars,
        baseColor,
        highlightColor,
        app.karaokeEnabled,
        sourceAnimation === "wordReveal",
        edge.blur,
        preciseSync
      );
      if (!body) {
        const fallback = escapeAssText(
          applyCaptionCapitalization(cue.text, app.capitalization)
        );
        dialogueLines.push(
          `Dialogue: 0,${start},${end},Default,,0,0,0,,${override}${fallback}`
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
    if (!overlay.text.trim() || overlay.endTimeSeconds <= overlay.startTimeSeconds) {
      continue;
    }
    const start = formatAssTime(overlay.startTimeSeconds, "start");
    const end = formatAssTime(overlay.endTimeSeconds, "end");
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
    overlayStyleLine,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...dialogueLines,
    "",
  ].join("\n");
}
