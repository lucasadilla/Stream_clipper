export interface PublicImpact {
  totalViews: string | null;
  countedAccounts: number;
  knownAccounts: number;
  refreshedAt: string | null;
}
export function utcDay(now = new Date()): Date {
  return new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
}
export function safeViewCount(value: unknown): bigint | null {
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return null;
  return BigInt(value);
}
export function formatViewCount(value: string): string {
  try { return BigInt(value).toLocaleString("en-US"); } catch { return "—"; }
}
