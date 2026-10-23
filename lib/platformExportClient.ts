import { operationKey, rememberedOperation, rememberOperation, operationDelay } from "./clientOperationRecovery";
export function finishedPlatformStreamUrl(downloadUrl: string): string | null {
  const match = /^\/api\/platform-exports\/([a-zA-Z0-9_-]+)\/download(?:\?|$)/.exec(downloadUrl);
  return match ? `/api/platform-exports/${match[1]}/stream` : null;
}
/** Resume the same pack after connection loss. No copy generation or render is repeated. */
export async function preparePlatformFile(clipId: string, platform: string, request: Record<string, unknown>, onProgress: (value: number, stage: string) => void): Promise<string> {
  const key = await operationKey("platform", { clipId, platform, request });
  let packId = rememberedOperation(key);
  if (!packId) {
    const response = await fetch(`/api/clips/${clipId}/platform-exports`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) });
    const body = await response.json();
    if (!response.ok || !body.pack?.id) throw new Error(body.error || "Could not prepare this platform export.");
    packId = body.pack.id; rememberOperation(key, packId);
  }
  const started = Date.now(); let lastSuccess = started, errors = 0;
  while (Date.now() - started < 30 * 60_000) {
    try {
      const response = await fetch(`/api/platform-export-packs/${packId}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
      const body = await response.json();
      if ([401, 403, 404].includes(response.status)) { rememberOperation(key, null); throw new PlatformFileError(body.error || "This export is unavailable. Retry to prepare it again."); }
      if (!response.ok) throw new Error(body.error || "Could not check the export.");
      lastSuccess = Date.now(); errors = 0;
      const item = body.pack?.exports?.find((candidate: { platform: string }) => candidate.platform === platform);
      if (item?.status === "failed" || item?.status === "cancelled") { rememberOperation(key, null); throw new PlatformFileError(item.errorMessage || "Platform export failed. Retry with your saved settings."); }
      if (item?.status === "completed" && item.downloadUrl) { onProgress(100, "completed"); return item.downloadUrl; }
      onProgress(item?.progress || 0, (item?.progress || 0) < 40 ? "prepare_source" : "encoding");
    } catch (error) {
      if (error instanceof PlatformFileError) throw error;
      errors++; onProgress(0, "reconnecting");
      if (Date.now() - lastSuccess >= 2 * 60_000) throw new Error("Connection interrupted. Your platform export is saved. Retry to resume it.");
    }
    await operationDelay(errors ? Math.min(15_000, 1200 * 2 ** Math.min(4, errors - 1)) : 1200);
  }
  throw new Error("Your export is still saved on the server. Retry to resume checking it.");
}
class PlatformFileError extends Error {}
