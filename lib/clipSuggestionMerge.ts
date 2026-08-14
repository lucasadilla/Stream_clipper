/**
 * Merge a partial clip refresh without disrupting cards already on screen.
 * New clips are prepended in server order; existing clips keep their position.
 */
export function mergeClipSuggestions<T extends { id: string }>(
  current: T[],
  incoming: T[]
): T[] {
  if (incoming.length === 0) return current;

  const currentIds = new Set(current.map((clip) => clip.id));
  const incomingById = new Map(incoming.map((clip) => [clip.id, clip]));
  const newClips = incoming.filter((clip) => !currentIds.has(clip.id));
  const existingClips = current.map(
    (clip) => incomingById.get(clip.id) ?? clip
  );

  return [...newClips, ...existingClips];
}
