export interface RenderJobSelectionCandidate {
  outputPath: string | null;
  params: unknown;
}

export function isPreviewRenderJobParams(params: unknown): boolean {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return false;
  }
  return (params as Record<string, unknown>).preview === true;
}

/**
 * Preview renders are intentionally small and may finish after the master.
 * Never let a newer preview replace the final export used for downloads,
 * sharing, platform packaging, or publishing.
 */
export function selectLatestFinalRenderJob<
  T extends RenderJobSelectionCandidate,
>(jobs: readonly T[]): T | null {
  return (
    jobs.find(
      (job) => Boolean(job.outputPath) && !isPreviewRenderJobParams(job.params) &&
        !(job.params && typeof job.params === "object" && "platformTarget" in job.params && job.params.platformTarget)
    ) ?? null
  );
}
