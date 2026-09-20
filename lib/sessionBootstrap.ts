import type { StreamPlatform } from "@/lib/streamPlatform";
import type { SessionMode } from "@/lib/sessionMode";

export interface SessionBootstrap {
  id: string;
  mode: SessionMode;
  platform?: StreamPlatform;
  youtubeVideoId: string;
  youtubeUrl?: string | null;
  title?: string | null;
  thumbnailUrl?: string | null;
  liveStatus?: string | null;
}

function key(sessionId: string): string {
  return `clipper:sessionBootstrap:${sessionId}`;
}

export function writeSessionBootstrap(session: SessionBootstrap): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(key(session.id), JSON.stringify(session));
  } catch {
    // Navigation still works when browser storage is unavailable.
  }
}

export function readSessionBootstrap(
  sessionId: string
): SessionBootstrap | null {
  if (typeof window === "undefined") return null;
  try {
    const value = JSON.parse(sessionStorage.getItem(key(sessionId)) ?? "null") as
      | Partial<SessionBootstrap>
      | null;
    if (
      !value ||
      value.id !== sessionId ||
      typeof value.youtubeVideoId !== "string" ||
      (value.mode !== "agent" && value.mode !== "timeline")
    ) {
      return null;
    }
    return value as SessionBootstrap;
  } catch {
    return null;
  }
}
