export interface PostMetrics {
  views: number | null; impressions: number | null; likes: number | null; comments: number | null;
  shares: number | null; saves: number | null; averageViewPercent: number | null;
  averageWatchSeconds: number | null; completionPercent: number | null;
  note: string | null;
}
export function emptyPostMetrics(): PostMetrics {
  return { views: null, impressions: null, likes: null, comments: null, shares: null, saves: null,
    averageViewPercent: null, averageWatchSeconds: null, completionPercent: null, note: null };
}
export function metricNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}
export interface PerformanceResult {
  id: string; metrics: PostMetrics | null; refreshedAt: string | null; error: string | null;
  history: Array<{ at: string; views: number | null }>;
}
