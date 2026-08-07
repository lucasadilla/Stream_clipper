import { Fragment, useMemo } from "react";
import {
  applyCaptionCapitalization,
  type CaptionAppearance,
} from "@/lib/captionAppearance";
import { selectCaptionEmphasisWordIndex } from "@/lib/captionEmphasis";
import type { CaptionCue } from "@/lib/captionTrack";
import { cn } from "@/lib/cn";

export function CaptionCueText({
  cue,
  currentTime,
  appearance,
}: {
  cue: CaptionCue;
  currentTime: number;
  appearance: CaptionAppearance;
}) {
  const words = cue.words ?? [];
  const emphasisIndex = useMemo(
    () =>
      appearance.smartEmphasisEnabled
        ? selectCaptionEmphasisWordIndex(
            words.length > 0
              ? words.map((word) => word.word)
              : cue.text.split(/\s+/).filter(Boolean)
          )
        : null,
    [appearance.smartEmphasisEnabled, cue.text, words]
  );
  const lineBreaks = useMemo(() => {
    const breaks = new Set<number>();
    if (words.length === 0 || !cue.text.includes("\n")) return breaks;
    let wordCount = 0;
    const lines = cue.text.split("\n");
    for (let lineIndex = 0; lineIndex < lines.length - 1; lineIndex++) {
      wordCount += lines[lineIndex]!.trim().split(/\s+/).filter(Boolean).length;
      if (wordCount > 0) breaks.add(wordCount - 1);
    }
    return breaks;
  }, [cue.text, words.length]);

  const renderTimedWords =
    words.length > 0 &&
    (appearance.karaokeEnabled || appearance.smartEmphasisEnabled);

  if (renderTimedWords) {
    return words.map((word, index) => {
      const active = currentTime >= word.start && currentTime < word.end;
      const emphasized = emphasisIndex === index;
      const label = applyCaptionCapitalization(
        word.word,
        appearance.capitalization
      );
      const color = appearance.karaokeEnabled
        ? active
          ? appearance.highlightColor
          : appearance.color
        : emphasized
          ? appearance.highlightColor
          : appearance.color;
      return (
        <Fragment key={`${cue.id}-${index}`}>
          <span
            className={cn(
              emphasized && "caption-smart-emphasis-word",
              emphasized && active && "caption-smart-emphasis-word-active"
            )}
            style={{ color }}
          >
            {label}
          </span>
          {index < words.length - 1 ? (
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

  if (!appearance.smartEmphasisEnabled || emphasisIndex == null) {
    return applyCaptionCapitalization(cue.text, appearance.capitalization);
  }

  let wordIndex = -1;
  return cue.text.split(/(\s+)/).map((token, tokenIndex) => {
    if (/^\s+$/.test(token)) return token;
    wordIndex += 1;
    const emphasized = wordIndex === emphasisIndex;
    return (
      <span
        key={`${cue.id}-plain-${tokenIndex}`}
        className={cn(emphasized && "caption-smart-emphasis-word")}
        style={{
          color: emphasized ? appearance.highlightColor : appearance.color,
        }}
      >
        {applyCaptionCapitalization(token, appearance.capitalization)}
      </span>
    );
  });
}

