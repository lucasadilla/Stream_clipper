export function clipSharePath(clipId: string): string {
  return `/clips/${clipId}`;
}

export function clipShareUrl(clipId: string, origin = ""): string {
  const base = origin.replace(/\/$/, "");
  return `${base}${clipSharePath(clipId)}`;
}

export function clipStreamUrl(clipId: string): string {
  return `/api/clips/${clipId}/stream`;
}
