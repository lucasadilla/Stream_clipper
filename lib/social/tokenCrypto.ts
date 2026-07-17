import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";

const ALGO = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function resolveKey(): Buffer {
  const configured = process.env.SOCIAL_TOKEN_ENCRYPTION_KEY?.trim();
  if (configured) {
    // Accept base64 (32 bytes) or hex (64 chars) or any passphrase (hashed).
    if (/^[A-Za-z0-9+/]+=*$/.test(configured) && configured.length >= 40) {
      const decoded = Buffer.from(configured, "base64");
      if (decoded.length === 32) return decoded;
    }
    if (/^[0-9a-fA-F]{64}$/.test(configured)) {
      return Buffer.from(configured, "hex");
    }
    return createHash("sha256").update(configured).digest();
  }

  const fallback = process.env.AUTH_SECRET?.trim();
  if (fallback) {
    if (process.env.NODE_ENV === "production") {
      console.warn(
        "[social] SOCIAL_TOKEN_ENCRYPTION_KEY unset; deriving from AUTH_SECRET (set an explicit key)"
      );
    }
    return createHash("sha256").update(`social-tokens:${fallback}`).digest();
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("SOCIAL_TOKEN_ENCRYPTION_KEY (or AUTH_SECRET) is required to encrypt social tokens");
  }

  return createHash("sha256").update("clipper-dev-social-token-key").digest();
}

/** Encrypt a secret for at-rest storage. Format: base64(iv|tag|ciphertext). */
export function encryptSecret(plaintext: string): string {
  const key = resolveKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decryptSecret(payload: string): string {
  const key = resolveKey();
  const buf = Buffer.from(payload, "base64");
  if (buf.length < IV_LENGTH + TAG_LENGTH + 1) {
    throw new Error("Invalid encrypted token payload");
  }
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const data = buf.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
