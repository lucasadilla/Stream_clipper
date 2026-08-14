import { Fragment, useMemo } from "react";
import {
  applyCaptionCapitalization,
  type CaptionAppearance,
} from "@/lib/captionAppearance";
import type { CaptionCue } from "@/lib/captionTrack";

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

  const wordReveal = appearance.animation === "wordReveal";
  const renderTimedWords =
    words.length > 0 && (appearance.karaokeEnabled || wordReveal);

  if (renderTimedWords) {
    return words.map((word, index) => {
      const active = currentTime >= word.start && currentTime < word.end;
      const revealed = !wordReveal || currentTime >= word.start - 0.02;
      const label = applyCaptionCapitalization(
        word.word,
        appearance.capitalization
      );
      const color = appearance.karaokeEnabled
        ? active
          ? appearance.highlightColor
          : appearance.color
        : appearance.color;
      return (
        <Fragment key={`${cue.id}-${index}`}>
          <span
            className={wordReveal ? "caption-word-reveal" : undefined}
            style={{
              color,
              opacity: revealed ? 1 : 0,
            }}
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

  return applyCaptionCapitalization(cue.text, appearance.capitalization);
}

