import { describe, expect, it } from "vitest";
import {
  CREATOR_BETA_ACCESS_DAYS,
  creatorBetaExpirationFrom,
  isCreatorBetaAccessActive,
} from "@/lib/creatorBeta";

describe("Creator Beta access window", () => {
  const grantedAt = new Date("2026-08-12T12:00:00.000Z");
  const expiresAt = creatorBetaExpirationFrom(grantedAt);

  it("expires exactly 30 days after code redemption", () => {
    expect(CREATOR_BETA_ACCESS_DAYS).toBe(30);
    expect(expiresAt.toISOString()).toBe("2026-09-11T12:00:00.000Z");
  });

  it("is active before expiration", () => {
    expect(
      isCreatorBetaAccessActive(
        { betaAccess: true, betaGrantedAt: grantedAt, betaExpiresAt: expiresAt },
        new Date("2026-09-11T11:59:59.999Z")
      )
    ).toBe(true);
  });

  it("is inactive at expiration", () => {
    expect(
      isCreatorBetaAccessActive(
        { betaAccess: true, betaGrantedAt: grantedAt, betaExpiresAt: expiresAt },
        expiresAt
      )
    ).toBe(false);
  });

  it("does not activate beta without a grant date", () => {
    expect(isCreatorBetaAccessActive({ betaAccess: true }, grantedAt)).toBe(false);
  });
});
