import { createHash, timingSafeEqual } from "crypto";

export const CREATOR_BETA_EXPORT_LIMIT = 25;
export const CREATOR_BETA_UPLOAD_LIMIT = 10;
export const CREATOR_BETA_MAX_SOURCE_SECONDS = 3 * 60 * 60;
export const CREATOR_BETA_MAX_CLIP_SECONDS = 60;

export function isCreatorBetaEnabled(): boolean {
  const value = process.env.CREATOR_BETA_ENABLED?.trim().toLowerCase();
  return value !== "0" && value !== "false" && value !== "off";
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
