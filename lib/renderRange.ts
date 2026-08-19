/** True only when copying the source file would produce the requested range. */
export function rangeCoversWholeSource(
  startSeconds: number,
  endSeconds: number,
  sourceDurationSeconds: number | null | undefined,
  toleranceSeconds = 0.05
): boolean {
  if (
    !Number.isFinite(startSeconds) ||
    !Number.isFinite(endSeconds) ||
    typeof sourceDurationSeconds !== "number" ||
    !Number.isFinite(sourceDurationSeconds) ||
    sourceDurationSeconds <= 0
  ) {
    return false;
  }

  return (
    startSeconds <= toleranceSeconds &&
    endSeconds >= sourceDurationSeconds - toleranceSeconds
  );
}
