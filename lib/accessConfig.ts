function parseCsvEnv(name: string): string[] {
  const raw = process.env[name]?.trim();
  if (!raw) return [];
  return raw
    .split(/[,\n]+/)
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

export function normalizeLoginEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Owner / team emails that get unlimited access without an invite code. */
export function getUnlimitedAccessEmails(): Set<string> {
  return new Set(parseCsvEnv("UNLIMITED_ACCESS_EMAILS"));
}

/** Shared invite codes you can hand out (any email + valid code → unlimited). */
export function getAccessInviteCodes(): Set<string> {
  return new Set(
    parseCsvEnv("ACCESS_INVITE_CODES").map((code) => code.toLowerCase())
  );
}

export function isUnlimitedAccessEmail(email: string): boolean {
  return getUnlimitedAccessEmails().has(normalizeLoginEmail(email));
}

export function isValidAccessInviteCode(code: string): boolean {
  const normalized = code.trim().toLowerCase();
  if (!normalized) return false;
  return getAccessInviteCodes().has(normalized);
}
