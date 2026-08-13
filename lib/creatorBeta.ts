import { createHash, timingSafeEqual } from "crypto";

export const CREATOR_BETA_EXPORT_LIMIT = 25;
export const CREATOR_BETA_UPLOAD_LIMIT = 10;
export const CREATOR_BETA_MAX_SOURCE_SECONDS = 3 * 60 * 60;
export const CREATOR_BETA_MAX_CLIP_SECONDS = 60;
export const CREATOR_BETA_ACCESS_DAYS = 30;

export function isCreatorBetaEnabled(): boolean {
  const value = process.env.CREATOR_BETA_ENABLED?.trim().toLowerCase();
  return value !== "0" && value !== "false" && value !== "off";
}

type CreatorBetaDates = {
  betaAccess?: boolean;
  betaGrantedAt?: Date | string | null;
  betaExpiresAt?: Date | string | null;
};

function validDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function creatorBetaExpirationFrom(start: Date): Date {
  return new Date(start.getTime() + CREATOR_BETA_ACCESS_DAYS * 24 * 60 * 60 * 1000);
}

export function getCreatorBetaExpiration(
  account: CreatorBetaDates
): Date | null {
  const explicit = validDate(account.betaExpiresAt);
  if (explicit) return explicit;
  const grantedAt = validDate(account.betaGrantedAt);
  return grantedAt ? creatorBetaExpirationFrom(grantedAt) : null;
}

export function isCreatorBetaAccessActive(
  account: CreatorBetaDates,
  now = new Date()
): boolean {
  if (!account.betaAccess || !isCreatorBetaEnabled()) return false;
  const expiresAt = getCreatorBetaExpiration(account);
  return Boolean(expiresAt && expiresAt.getTime() > now.getTime());
}

export function normalizeCreatorBetaCode(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

export function hashCreatorBetaCode(value: string): string {
  return createHash("sha256")
    .update(normalizeCreatorBetaCode(value))
    .digest("hex");
}

export function hasCreatorBetaAdminAccess(request: Request): boolean {
  const configured = process.env.CREATOR_BETA_ADMIN_SECRET?.trim();
  const provided = request.headers.get("x-creator-beta-admin-secret")?.trim();
  if (!configured || !provided) return false;
  const expected = Buffer.from(configured);
  const actual = Buffer.from(provided);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
