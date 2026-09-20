import type { StreamPlatform } from "@/lib/streamPlatform";

export const STREAM_AUTOMATION_PLATFORMS = [
  "youtube",
  "twitch",
  "kick",
] as const;

export interface ParsedAutomationSource {
  platform: StreamPlatform;
  sourceUrl: string;
  sourceKey: string;
}

function parseHttpUrl(input: string): URL | null {
  const raw = input.trim();
  if (!raw) return null;
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
}

function cleanPath(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/";
}

/** Normalize a public creator channel into a stable account monitor target. */
export function parseAutomationSource(
  input: string
): ParsedAutomationSource | null {
  const url = parseHttpUrl(input);
  if (!url) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const path = cleanPath(url.pathname);

  if (host === "twitch.tv" || host === "m.twitch.tv") {
    const channel = path.split("/").filter(Boolean)[0]?.toLowerCase();
    if (!channel || ["videos", "directory", "settings", "search"].includes(channel)) {
      return null;
    }
    return {
      platform: "twitch",
      sourceUrl: `https://www.twitch.tv/${channel}`,
      sourceKey: channel,
    };
  }

  if (host === "kick.com") {
    const channel = path.split("/").filter(Boolean)[0]?.toLowerCase();
    if (!channel || ["terms", "privacy", "dmca"].includes(channel)) {
      return null;
    }
    return {
      platform: "kick",
      sourceUrl: `https://kick.com/${channel}`,
      sourceKey: channel,
    };
  }

  if (
    host === "youtube.com" ||
    host === "m.youtube.com" ||
    host === "music.youtube.com"
  ) {
    const parts = path.split("/").filter(Boolean);
    const first = parts[0];
    if (!first) return null;

    if (first.startsWith("@")) {
      const handle = first.toLowerCase();
      return {
        platform: "youtube",
        sourceUrl: `https://www.youtube.com/${handle}`,
        sourceKey: handle,
      };
    }

    if (["channel", "c", "user"].includes(first) && parts[1]) {
      const identifier = parts[1];
      return {
        platform: "youtube",
        sourceUrl: `https://www.youtube.com/${first}/${identifier}`,
        sourceKey: `${first}:${identifier.toLowerCase()}`,
      };
    }
  }

  return null;
}

export function automationLiveProbeUrl(source: ParsedAutomationSource): string {
  if (source.platform !== "youtube") return source.sourceUrl;
  return `${source.sourceUrl.replace(/\/+$/, "")}/live`;
}

export function automationBroadcastKey(input: {
  platform: StreamPlatform;
  sourceId: string;
  actualStartTime?: Date | null;
  raw?: Record<string, unknown> | null;
}): string {
  const rawId =
    typeof input.raw?.id === "string" || typeof input.raw?.id === "number"
      ? String(input.raw.id)
      : null;
  const nested = input.raw?.livestream;
  const nestedId =
    nested && typeof nested === "object" &&
    (typeof (nested as { id?: unknown }).id === "string" ||
      typeof (nested as { id?: unknown }).id === "number")
      ? String((nested as { id: string | number }).id)
      : null;
  const identity =
    nestedId || rawId || input.actualStartTime?.toISOString() || input.sourceId;
  return `${input.platform}:${identity}`;
}

export function sanitizeAutomationError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/--cookies\s+[^\s]+/gi, "--cookies [configured]")
    .replace(/(authorization|bearer|token|secret|password)=?\s*[^\s]+/gi, "$1=[redacted]")
    .slice(0, 2000);
}

export function parseDestinationAccountIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 20)
    )
  );
}
