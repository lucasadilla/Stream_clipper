export function mediaTimeForTimeline(
  timelineSeconds: number,
  timelineOffsetSeconds: number
): number {
  return Math.max(0, timelineSeconds - timelineOffsetSeconds);
}

export function timelineTimeForMedia(
  mediaSeconds: number,
  timelineOffsetSeconds: number
): number {
  return Math.max(0, mediaSeconds + timelineOffsetSeconds);
}

export function mediaCoversTimelineRange(options: {
  mediaDurationSeconds: number;
  timelineOffsetSeconds: number;
  rangeStartSeconds: number;
  rangeEndSeconds: number;
  toleranceSeconds?: number;
}): boolean {
  const {
    mediaDurationSeconds,
    timelineOffsetSeconds,
    rangeStartSeconds,
    rangeEndSeconds,
    toleranceSeconds = 0.5,
  } = options;
  if (
    Number.isNaN(mediaDurationSeconds) ||
    mediaDurationSeconds <= 0 ||
    !Number.isFinite(timelineOffsetSeconds) ||
    !Number.isFinite(rangeStartSeconds) ||
    !Number.isFinite(rangeEndSeconds) ||
    rangeEndSeconds <= rangeStartSeconds
  ) {
    return false;
  }

  const mediaStart = rangeStartSeconds - timelineOffsetSeconds;
  const mediaEnd = rangeEndSeconds - timelineOffsetSeconds;
  return (
    mediaStart >= -toleranceSeconds &&
    mediaEnd <= mediaDurationSeconds + toleranceSeconds
  );
}
