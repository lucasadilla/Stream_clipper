/** Bound platform requests. Never automatically retry a non-idempotent post. */
export function socialFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(90_000) });
}
