import { describe, expect, it } from "vitest";
import { parseDownloadByteRange } from "@/lib/storage";

describe("resumable downloads", () => {
  it("serves an explicit byte range", () => {
    expect(parseDownloadByteRange("bytes=100-299", 1_000))
      .toEqual({ start: 100, end: 299 });
  });

  it("serves from an offset through the final byte", () => {
    expect(parseDownloadByteRange("bytes=750-", 1_000))
      .toEqual({ start: 750, end: 999 });
  });

  it("clamps oversized ends and rejects invalid ranges", () => {
    expect(parseDownloadByteRange("bytes=900-5000", 1_000))
      .toEqual({ start: 900, end: 999 });
    expect(parseDownloadByteRange("bytes=1000-", 1_000)).toBe("invalid");
    expect(parseDownloadByteRange("bytes=500-200", 1_000)).toBe("invalid");
  });
});
