import { describe, expect, it } from "vitest";
import { formatViewCount, safeViewCount, utcDay } from "@/lib/publicLanding";
import { HERO_SHORTS, HERO_YOUTUBE_CHANNEL } from "@/lib/heroShorts";
describe("minimal landing data", () => {
  it("keeps missing counts distinct from zero and preserves unsigned API integers", () => {
    expect([null, undefined, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, "bad"].map(safeViewCount)).toEqual(Array(7).fill(null));
    expect(safeViewCount(0)).toBe(BigInt(0));
    expect(safeViewCount("9007199254740993000")).toBe(BigInt("9007199254740993000"));
    expect(formatViewCount("9007199254740993000")).toBe("9,007,199,254,740,993,000");
  });
  it("refreshes by UTC date rather than process start or server timezone", () => {
    expect(utcDay(new Date("2026-10-23T23:59:59-04:00")).toISOString()).toBe("2026-10-24T00:00:00.000Z");
  });
  it("uses verified public Shorts from the requested channel, with no fabricated videos", () => {
    expect(HERO_YOUTUBE_CHANNEL).toBe("https://www.youtube.com/@StreamClipperAdmin/shorts");
    expect(HERO_SHORTS.map(short => short.id)).toEqual(["-iin9hAUjMU", "Q7y88c4ubXc", "ozjAb4914s8"]);
    expect(HERO_SHORTS.every(short => short.poster.startsWith(`https://i.ytimg.com/vi/${short.id}/`))).toBe(true);
  });
});
