// Public Shorts verified on @StreamClipperAdmin, 23 October 2026.
export const HERO_YOUTUBE_CHANNEL = "https://www.youtube.com/@StreamClipperAdmin/shorts";
export const HERO_CHANNEL_ID = "UC7nH5awEsodH0wuAAbWN8kw";
// The public original's transcript places this moment at 22:06 (includes lead-in context).
export const VERIFIED_COMPARISON_SOURCE = { videoId: "HzraLR2VkNM", startSeconds: 1326, endSeconds: 1406 };
export interface FeaturedShort {
  id: string;
  title: string;
  poster: string;
  views: string | null;
  refreshedAt: string | null;
  durationSeconds: number | null;
  source: { videoId: string; startSeconds: number; endSeconds: number } | null;
}
export const HERO_SHORTS = [
  {
    id: "-iin9hAUjMU",
    title: 'ohnepixel — "I have 5 queens".',
    poster: "https://i.ytimg.com/vi/-iin9hAUjMU/oar1.jpg?sqp=-oaymwEoCJUDENAFSFqQAgHyq4qpAxcIARUAAIhC2AEB4gEKCBgQAhgGOAFAAQ==&rs=AOn4CLChgPYlWWHa5XXlS9bFG5_WrAE3Gg",
  },
  {
    id: "Q7y88c4ubXc",
    title: "Ben Affleck’s Turbulent Year: Navigating Grief & The Art of Not Caring.",
    poster: "https://i.ytimg.com/vi/Q7y88c4ubXc/oar3.jpg?sqp=-oaymwEoCJUDENAFSFqQAgHyq4qpAxcIARUAAIhC2AEB4gEKCBgQAhgGOAFAAQ==&rs=AOn4CLCAPtmYH2X4KDOV66ejM2AvrFblMA",
  },
  {
    id: "ozjAb4914s8",
    title: "IShowSpeed frustrated by fake dad donations #494",
    poster: "https://i.ytimg.com/vi/ozjAb4914s8/oar2.jpg?sqp=-oaymwEoCJUDENAFSFqQAgHyq4qpAxcIARUAAIhC2AEB4gEKCBgQAhgGOAFAAQ==&rs=AOn4CLBjS5mI8FX_Eif9A8ZKsfZLk0eyDw",
  },
] as const;

export function fallbackShorts(): FeaturedShort[] {
  return HERO_SHORTS.map(short => ({ ...short, views: null, refreshedAt: null,
    durationSeconds: short.id === "Q7y88c4ubXc" ? 70 : null,
    source: short.id === "Q7y88c4ubXc" ? VERIFIED_COMPARISON_SOURCE : null }));
}

export function sampleShort(): FeaturedShort { return fallbackShorts().find(short => short.id === "Q7y88c4ubXc")!; }

export function selectFeaturedShorts<T extends { id: string; pinSlot: number | null; views: bigint | null; publishedAt: Date; eligible: boolean }>(rows: T[]): T[] {
  const eligible = rows.filter(row => row.eligible);
  const slots: Array<T | undefined> = Array(3);
  eligible.forEach(row => { if (row.pinSlot !== null && row.pinSlot >= 0 && row.pinSlot < 3) slots[row.pinSlot] = row; });
  const automatic = eligible.filter(row => !slots.some(pin => pin?.id === row.id));
  // Reserve one open position for the newest Short, then fill with proven performers.
  automatic.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
  const open = slots.findIndex(row => !row);
  if (open >= 0) slots[open] = automatic.shift();
  automatic.sort((a, b) => a.views === b.views ? b.publishedAt.getTime() - a.publishedAt.getTime() : (a.views ?? BigInt(-1)) > (b.views ?? BigInt(-1)) ? -1 : 1);
  for (let i = 0; i < slots.length; i++) if (!slots[i]) slots[i] = automatic.shift();
  return slots.filter((row): row is T => Boolean(row));
}

export function formatShortViews(value: string): string {
  // BigInt avoids losing precision for large platform counts.
  return `${BigInt(value).toLocaleString("en-US")} views`;
}
