export function clipDownloadUrl(clipSuggestionId: string): string {
  return `/api/clips/${clipSuggestionId}/download`;
}

export function renderJobDownloadUrl(renderJobId: string): string {
  return `/api/render-jobs/${renderJobId}/download`;
}

export function downloadUrlForRenderResult(result: {
  jobId: string;
  clipSuggestionId?: string | null;
}): string {
  return result.clipSuggestionId
    ? clipDownloadUrl(result.clipSuggestionId)
    : renderJobDownloadUrl(result.jobId);
}

export function storageFileUrl(relativePath: string): string {
  return `/api/storage/${relativePath.replace(/\\/g, "/")}`;
}
