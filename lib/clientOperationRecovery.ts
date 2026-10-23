/** Store only an opaque operation ID and timestamp, never captions or tokens. */
const TTL = 24 * 60 * 60 * 1000;
export function operationIdentity(request: unknown): string {
  const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, stable(value)])) : value;
  return JSON.stringify(stable(request));
}
export async function operationKey(kind: string, request: unknown): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(operationIdentity(request)));
  return `clipper:operation:${kind}:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")}`;
}
export function rememberedOperation(key: string | null): string | null {
  if (!key || typeof window === "undefined") return null;
  try {
    const row = JSON.parse(window.localStorage.getItem(key) || "null");
    if (row && typeof row.id === "string" && /^[a-zA-Z0-9_-]{1,160}$/.test(row.id) && Number.isFinite(row.at) && row.at <= Date.now() && Date.now() - row.at < TTL) return row.id;
    window.localStorage.removeItem(key);
  } catch { /* Storage can be unavailable in private mode. */ }
  return null;
}
export function rememberOperation(key: string | null, id: string | null) {
  if (!key || typeof window === "undefined") return;
  try { if (id) window.localStorage.setItem(key, JSON.stringify({ id, at: Date.now() })); else window.localStorage.removeItem(key); } catch { /* Recovery is optional; the server job remains durable. */ }
}
export function operationDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(new DOMException("Request aborted", "AbortError")); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, ms);
    if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
  });
}
