/** Minimum clip length for render / export. */
export const MIN_CLIP_SECONDS = 3;

/** Hard maximum for every suggested, edited, analyzed, and exported short. */
export const MAX_CLIP_SECONDS = 2 * 60;

export function formatMaxClipLabel(): string {
  return `${MAX_CLIP_SECONDS / 60} minutes`;
}
