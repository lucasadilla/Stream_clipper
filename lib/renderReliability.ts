/**
 * Render-level retries are only useful when a fresh process can change the
 * result. Source acquisition already exhausts its own bounded format/client
 * fallbacks, so replaying that entire stage creates a long apparent freeze.
 */
export function isRetryableRenderFailure(message: string): boolean {
  return /\b(?:econnreset|econnrefused|etimedout|eai_again)\b|temporary failure|network is unreachable|connection reset|worker restarted/i.test(
    message
  );
}
