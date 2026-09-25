import { describe, expect, it } from "vitest";
import {
  configureDatabaseUrl,
  databaseBackoffDelayMs,
  isTransientDatabaseError,
} from "@/lib/databaseReliability";

describe("database reliability", () => {
  it("caps Prisma's pool for a Supabase transaction pooler", () => {
    const configured = configureDatabaseUrl(
      "postgresql://user:secret@example.supabase.com:6543/postgres?pgbouncer=true&sslmode=require"
    );
    const url = new URL(configured!);

    expect(url.searchParams.get("connection_limit")).toBe("5");
    expect(url.searchParams.get("pool_timeout")).toBe("20");
    expect(url.searchParams.get("connect_timeout")).toBe("10");
    expect(url.searchParams.get("sslmode")).toBe("require");
  });

  it("preserves explicit pool settings and direct database URLs", () => {
    const pooled = configureDatabaseUrl(
      "postgresql://user:secret@pooler.example.com:6543/postgres?connection_limit=2&pool_timeout=7"
    );
    const pooledUrl = new URL(pooled!);
    expect(pooledUrl.searchParams.get("connection_limit")).toBe("2");
    expect(pooledUrl.searchParams.get("pool_timeout")).toBe("7");

    const direct = "postgresql://user:secret@localhost:5432/postgres";
    expect(configureDatabaseUrl(direct)).toBe(direct);
  });

  it("recognizes Prisma pool and connection failures", () => {
    expect(isTransientDatabaseError({ code: "P2024", message: "pool timeout" })).toBe(true);
    expect(
      isTransientDatabaseError(
        new Error("An existing connection was forcibly closed by the remote host")
      )
    ).toBe(true);
    expect(isTransientDatabaseError(new Error("Unique constraint failed"))).toBe(false);
  });

  it("backs the worker off exponentially with a ceiling", () => {
    expect(databaseBackoffDelayMs(1)).toBe(5_000);
    expect(databaseBackoffDelayMs(3)).toBe(20_000);
    expect(databaseBackoffDelayMs(20)).toBe(120_000);
  });
});
