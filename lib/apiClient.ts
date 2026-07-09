/** Safe JSON parse for client fetch responses (handles empty bodies). */
export async function fetchJson<T = unknown>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<{ ok: boolean; status: number; data: T }> {
  const maxAttempts = 3;
  let lastPreview = "";

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetch(input, {
      ...init,
      credentials: init?.credentials ?? "include",
    });
    const text = await res.text();
    lastPreview = text.slice(0, 80).replace(/\s+/g, " ");

    if (!text.trim()) {
      if (!res.ok && attempt < maxAttempts - 1) {
        await sleep(400 * (attempt + 1));
        continue;
      }
      return { ok: res.ok, status: res.status, data: {} as T };
    }

    // Dev server returns HTML error pages while routes hot-recompile.
    const looksLikeHtml = text.trimStart().startsWith("<");
    if (looksLikeHtml) {
      if (attempt < maxAttempts - 1) {
        await sleep(500 * (attempt + 1));
        continue;
      }
      throw new Error(
        "Server temporarily unavailable (dev server was recompiling). Refresh the page or wait a moment."
      );
    }

    try {
      return {
        ok: res.ok,
        status: res.status,
        data: JSON.parse(text) as T,
      };
    } catch {
      if (attempt < maxAttempts - 1 && res.status >= 500) {
        await sleep(400 * (attempt + 1));
        continue;
      }
      throw new Error(
        res.ok
          ? `Server returned invalid JSON (${lastPreview})`
          : `Request failed (${res.status}): ${lastPreview}`
      );
    }
  }

  throw new Error(
    `Request failed after ${maxAttempts} attempts: ${lastPreview}`
  );
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
