export const SESSION_MODES = ["timeline", "agent"] as const;
export type SessionMode = (typeof SESSION_MODES)[number];

export function normalizeSessionMode(value: unknown): SessionMode {
  return value === "agent" ? "agent" : "timeline";
}

export function isAgentMode(value: unknown): boolean {
  return normalizeSessionMode(value) === "agent";
}
