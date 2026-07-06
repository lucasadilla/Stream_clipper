/** Minimum clip length for render / export. */
export const MIN_CLIP_SECONDS = 3;

/** Maximum clip length for manual clips and exports (10 minutes). */
export const MAX_CLIP_SECONDS = 10 * 60;

export function formatMaxClipLabel(): string {
  return `${MAX_CLIP_SECONDS / 60} minutes`;
}
