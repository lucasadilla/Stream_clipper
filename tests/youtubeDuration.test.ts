import { describe, expect, it } from "vitest";
import { resolveVideoDurationFromMetadata } from "@/lib/youtube";

describe("resolveVideoDurationFromMetadata", () => {
  it("does not measure an ended VOD from its start time to today", () => {
    const duration = resolveVideoDurationFromMetadata(
      {
        contentDetails: { duration: "PT1H2M3S" },
        liveStreamingDetails: {
          actualStartTime: "2024-01-01T12:00:00.000Z",
        },
      },
      {
        actualStartTime: new Date("2024-01-01T12:00:00.000Z"),
        liveStatus: "completed",
        nowMs: Date.parse("2026-07-30T12:00:00.000Z"),
      }
    );
    expect(duration).toBe(3723);
  });

  it("uses an explicit start/end span when encoded duration is unavailable", () => {
    const duration = resolveVideoDurationFromMetadata(
      {
        liveStreamingDetails: {
          actualStartTime: "2026-01-01T12:00:00.000Z",
          actualEndTime: "2026-01-01T13:30:00.000Z",
        },
      },
      { liveStatus: "completed" }
    );
    expect(duration).toBe(5400);
  });

  it("keeps growing an active live stream from its start time", () => {
    const duration = resolveVideoDurationFromMetadata(
      {
        liveStreamingDetails: {
          actualStartTime: "2026-07-29T10:00:00.000Z",
        },
        is_live: true,
      },
      { nowMs: Date.parse("2026-07-29T10:45:00.000Z") }
    );
    expect(duration).toBe(2700);
  });
});
