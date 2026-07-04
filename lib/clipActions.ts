import { triggerFileDownload } from "@/lib/clientDownload";
import { clipDownloadUrl } from "@/lib/downloadUrls";
import { formatSeconds } from "@/lib/time";
import type { RenderFormat } from "@/lib/renderFormat";
import type { ClipSelection } from "@/components/LiveTimeline";
import type { CaptionAppearance } from "@/lib/captionAppearance";

export async function saveClip(
  sessionId: string,
  selection: ClipSelection,
  title?: string
) {
  const res = await fetch(`/api/sessions/${sessionId}/clips`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: title || `Clip ${formatSeconds(selection.start)}`,
      startTimeSeconds: selection.start,
      endTimeSeconds: selection.end,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Failed to create clip");
  return data.clip as { id: string; title: string };
}

export async function renderClip(
  clipId: string,
  format: RenderFormat = "vertical",
  includeCaptions = true,
  captionAppearance?: CaptionAppearance
) {
  const res = await fetch(`/api/clips/${clipId}/render`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ includeCaptions, format, captionAppearance }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Render failed");
  return data as { downloadUrl?: string; jobId: string };
}

export async function saveAndRenderClip(
  sessionId: string,
  selection: ClipSelection,
  title?: string,
  format: RenderFormat = "vertical",
  includeCaptions = true,
  captionAppearance?: CaptionAppearance
) {
  const clip = await saveClip(sessionId, selection, title);
  const result = await renderClip(clip.id, format, includeCaptions, captionAppearance);
  const url = result.downloadUrl ?? clipDownloadUrl(clip.id);
  const suffix = format === "native" ? "-native" : "-vertical";
  await triggerFileDownload(url, `${clip.title || "clip"}${suffix}.mp4`);
  return clip;
}
