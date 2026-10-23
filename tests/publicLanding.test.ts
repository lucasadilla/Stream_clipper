import { describe, expect, it } from "vitest";
import { formatViewCount, safeViewCount, selectShowcaseMix, showcaseIsPublic, utcDay, type PublicShowcaseClip } from "@/lib/publicLanding";
describe("honest public landing data", () => {
  it("keeps unknown and invalid counts distinct from a real zero, without rounding huge numbers", () => {
    expect([null, undefined, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, "123"].map(safeViewCount)).toEqual(Array(7).fill(null));
    expect(safeViewCount(0)).toBe(BigInt(0));
    expect(formatViewCount("9007199254740993000")).toBe("9,007,199,254,740,993,000");
  });
  it("uses calendar days in UTC rather than server timezone or a restart-based 24h interval", () => {
    expect(utcDay(new Date("2026-10-23T23:59:59-04:00")).toISOString()).toBe("2026-10-24T00:00:00.000Z");
  });
  it("requires approval and current consent, with no public access for pending or withdrawn clips", () => {
    const now = new Date();
    expect(showcaseIsPublic({ status: "approved", consentAt: now, approvedAt: now })).toBe(true);
    for (const row of [{ status: "pending", consentAt: now, approvedAt: now }, { status: "withdrawn", consentAt: null, approvedAt: now }, { status: "approved", consentAt: null, approvedAt: now }, { status: "approved", consentAt: now, approvedAt: null }]) expect(showcaseIsPublic(row)).toBe(false);
  });
  it("chooses the strongest gaming, podcast, and IRL examples without duplicating a clip", () => {
    const clip = (id: string, category: string, views: string | null) => ({ id, category, views }) as PublicShowcaseClip;
    const mixed = selectShowcaseMix([clip("g1", "gaming", "100"), clip("pod", "podcast", "9007199254740993000"), clip("irl", "irl", null), clip("g2", "gaming", "1000")]);
    expect(mixed.map(row => row.id)).toEqual(["g2", "pod", "irl", "g1"]);
  });
});
