import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function hashOAuthState(state: string) {
  return createHash("sha256").update(state).digest("hex");
}

function mediaGrantSecret(): string {
  return (
    process.env.SOCIAL_TOKEN_ENCRYPTION_KEY?.trim() ||
    process.env.AUTH_SECRET?.trim() ||
    "clipper-dev-media-grant"
  );
}

/** Short-lived signed grant so Meta can fetch a local video over HTTPS. */
export function createMediaGrant(options: {
  filePath: string;
  expiresInSeconds?: number;
}): { token: string; expiresAt: Date } {
  const expiresAt = new Date(
    Date.now() + (options.expiresInSeconds ?? 60 * 60) * 1000
  );
  const payload = Buffer.from(
    JSON.stringify({
      p: options.filePath,
      e: expiresAt.getTime(),
    }),
    "utf8"
  ).toString("base64url");
  const sig = createHmac("sha256", mediaGrantSecret())
    .update(payload)
    .digest("base64url");
  return { token: `${payload}.${sig}`, expiresAt };
}

export function verifyMediaGrant(token: string): { filePath: string } | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", mediaGrantSecret())
    .update(payload)
    .digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      p?: string;
      e?: number;
    };
    if (!data.p || !data.e || data.e < Date.now()) return null;
    return { filePath: data.p };
  } catch {
    return null;
  }
}

export function publicOrigin(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
    "http://localhost:3000"
  );
}
