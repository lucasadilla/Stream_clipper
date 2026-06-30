/** Parse YouTube API ISO 8601 duration (e.g. PT1H2M3S) to seconds. */
export function parseIso8601Duration(iso: string): number {
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/);
  if (!m) return 0;
  const h = Number(m[1] ?? 0);
  const min = Number(m[2] ?? 0);
  const s = Number(m[3] ?? 0);
  return h * 3600 + min * 60 + s;
}

export function formatSeconds(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  }
  return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
}

export function formatDuration(seconds: number): string {
  const dur = Math.max(0, seconds);
  if (dur < 60) return `${Math.round(dur)}s`;
  const m = Math.floor(dur / 60);
  const s = Math.round(dur % 60);
  return `${m}m ${s}s`;
}

export function parseSrtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")},${ms.toString().padStart(3, "0")}`;
}

export interface SrtEntry {
  startTimeSeconds: number;
  endTimeSeconds: number;
  text: string;
}

export function generateSrt(entries: SrtEntry[]): string {
  return entries
    .map((entry, i) => {
      const start = parseSrtTime(entry.startTimeSeconds);
      const end = parseSrtTime(entry.endTimeSeconds);
      return `${i + 1}\n${start} --> ${end}\n${entry.text}\n`;
    })
    .join("\n");
}

export function getWindowStart(timeSeconds: number, windowSize: number): number {
  return Math.floor(timeSeconds / windowSize) * windowSize;
}
