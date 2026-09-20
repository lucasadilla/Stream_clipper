import { describe, expect, it } from "vitest";
import {
  mediaCoversTimelineRange,
  mediaTimeForTimeline,
  timelineTimeForMedia,
} from "@/lib/clipPlaybackTime";

describe("clip playback time mapping", () => {
  it("keeps full-source playback on the absolute timeline", () => {
    expect(mediaTimeForTimeline(778, 0)).toBe(778);
    expect(timelineTimeForMedia(778, 0)).toBe(778);
  });

  it("maps a clip proxy back to absolute transcript time", () => {
    const timelineOffset = 775;
    expect(mediaTimeForTimeline(778, timelineOffset)).toBe(3);
    expect(timelineTimeForMedia(3, timelineOffset)).toBe(778);
  });

  it("never seeks before the beginning of proxy media", () => {
    expect(mediaTimeForTimeline(10, 20)).toBe(0);
  });

  it("rejects a preview containing only a fraction of the selected clip", () => {
    expect(
      mediaCoversTimelineRange({
        mediaDurationSeconds: 0.733,
        timelineOffsetSeconds: 2831.257,
        rangeStartSeconds: 2831.257,
        rangeEndSeconds: 2858.767,
      })
    ).toBe(false);
  });

  it("accepts a clip proxy covering the complete selected range", () => {
    expect(
      mediaCoversTimelineRange({
        mediaDurationSeconds: 27.507,
        timelineOffsetSeconds: 2831.257,
        rangeStartSeconds: 2831.257,
        rangeEndSeconds: 2858.767,
      })
    ).toBe(true);
  });
});
