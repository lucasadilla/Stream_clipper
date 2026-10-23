export interface PublicImpact {
  totalViews: string | null;
  countedPosts: number;
  knownPosts: number;
  refreshedAt: string | null;
}
export interface PublicShowcaseClip {
  id: string;
  sourceGroup: string;
  sourceTitle: string;
  category: string;
  views: string | null;
  title: string;
  creatorName: string;
  platform: string;
  durationSeconds: number;
  videoUrl: string;
  posterUrl: string;
  sourceVideoUrl: string | null;
  sourcePosterUrl: string | null;
}
export function utcDay(now = new Date()): Date {
  return new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
}
export function safeViewCount(value: unknown): bigint | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return null;
  return BigInt(value);
}
export function showcaseIsPublic(row: { status: string; consentAt: Date | null; approvedAt: Date | null }): boolean {
  return row.status === "approved" && Boolean(row.consentAt && row.approvedAt);
}
export function formatViewCount(value: string): string {
  try { return BigInt(value).toLocaleString("en-US"); } catch { return "—"; }
}
/** Lead with one strong example of each kind before filling the remaining slots. */
export function selectShowcaseMix(clips: PublicShowcaseClip[]): PublicShowcaseClip[] {
  const ranked = [...clips].sort((a, b) => {
    const left = BigInt(a.views ?? "-1"), right = BigInt(b.views ?? "-1");
    return left === right ? 0 : left > right ? -1 : 1;
  });
  const lead = ["gaming", "podcast", "irl"].flatMap(category => ranked.find(clip => clip.category === category) ?? []);
  return [...lead, ...ranked.filter(clip => !lead.includes(clip))].slice(0, 12);
}
