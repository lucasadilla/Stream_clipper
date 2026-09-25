import { Fragment, useMemo } from "react";
import {
  applyCaptionCapitalization,
  type CaptionAppearance,
} from "@/lib/captionAppearance";
import type { CaptionCue } from "@/lib/captionTrack";
import {
  captionCueTokens,
  effectiveCaptionAnimation,
} from "@/lib/captionDirector";
import { captionWordsForAnimation } from "@/lib/captionTrack";

export function CaptionCueText({
  cue,
  currentTime,
  appearance,
}: {
  cue: CaptionCue;
  currentTime: number;
  appearance: CaptionAppearance;
}) {
  const timedWords = useMemo(() => captionWordsForAnimation(cue), [cue]);
  const tokens = useMemo(
    () =>
      timedWords.length > 0
        ? timedWords.map((word) => word.word)
        : captionCueTokens(cue),
    [cue, timedWords]
  );
  const lineBreaks = useMemo(() => {
    const breaks = new Set<number>();
    if (tokens.length === 0 || !cue.text.includes("\n")) return breaks;
    let wordCount = 0;
    const lines = cue.text.split("\n");
    for (let lineIndex = 0; lineIndex < lines.length - 1; lineIndex++) {
      wordCount += lines[lineIndex]!.trim().split(/\s+/).filter(Boolean).length;
      if (wordCount > 0) breaks.add(wordCount - 1);
    }
    return breaks;
  }, [cue.text, tokens.length]);

  const animation = effectiveCaptionAnimation(cue, appearance.animation);
  const wordReveal = animation === "wordReveal" && timedWords.length > 0;
  const renderTimedWords =
    timedWords.length > 0 && (wordReveal || appearance.karaokeEnabled);
  const speakerColor =
    cue.speakerColor && (cue.speakerConfidence ?? 1) >= 0.45
      ? cue.speakerColor
      : appearance.color;

  if (renderTimedWords) {
    return tokens.map((token, index) => {
      const timedWord = timedWords[index];
      const active = Boolean(
        timedWord &&
          currentTime >= timedWord.start &&
          currentTime < timedWord.end
      );
      const revealed =
        !wordReveal || !timedWord || currentTime >= timedWord.start - 0.02;
      const label = applyCaptionCapitalization(
        token,
        appearance.capitalization
      );
      return (
        <Fragment key={`${cue.id}-${index}`}>
          <span
            className={wordReveal ? "caption-word-reveal" : undefined}
            style={{
              color:
                appearance.karaokeEnabled && active
                  ? appearance.highlightColor
                  : speakerColor,
              opacity: revealed ? 1 : 0,
              transform: wordReveal
                ? revealed
                  ? "translateY(0)"
                  : "translateY(4px)"
                : undefined,
              filter: wordReveal
                ? revealed
                  ? "blur(0)"
                  : "blur(2px)"
                : undefined,
            }}
          >
            {label}
          </span>
          {index < tokens.length - 1 ? (
            lineBreaks.has(index) ? (
              <br />
            ) : (
              " "
            )
          ) : null}
        </Fragment>
      );
    });
  }

  return (
    <span
      style={{ color: speakerColor }}
      aria-label={cue.speakerLabel ? `${cue.speakerLabel}: ${cue.text}` : undefined}
    >
      {applyCaptionCapitalization(cue.text, appearance.capitalization)}
    </span>
  );
}
