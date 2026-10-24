export const SAMPLE_DURATION = 70;
export function sampleRange(start: number, end: number): { start: number; end: number } {
  const safeStart = Math.max(0, Math.min(SAMPLE_DURATION - 1, Number.isFinite(start) ? Math.floor(start) : 0));
  const safeEnd = Math.max(safeStart + 1, Math.min(SAMPLE_DURATION, Number.isFinite(end) ? Math.ceil(end) : SAMPLE_DURATION));
  return { start: safeStart, end: safeEnd };
}
export function sampleTimestamp(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}
