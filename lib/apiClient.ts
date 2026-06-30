/** Safe JSON parse for client fetch responses (handles empty bodies). */
export async function fetchJson<T = unknown>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await fetch(input, init);
  const text = await res.text();
  if (!text.trim()) {
    return {
      ok: res.ok,
      status: res.status,
      data: {} as T,
    };
  }
  try {
    return {
      ok: res.ok,
      status: res.status,
      data: JSON.parse(text) as T,
    };
  } catch {
    const preview = text.slice(0, 80).replace(/\s+/g, " ");
    throw new Error(
      res.ok
        ? `Server returned invalid JSON (${preview})`
        : `Request failed (${res.status}): ${preview}`
    );
  }
}
