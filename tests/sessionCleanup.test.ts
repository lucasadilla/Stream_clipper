import { describe, expect, it } from "vitest";
import {
  isYtDlpSplitSourceFile,
  isYtDlpTempFile,
} from "@/lib/storage";
import {
  selectDuplicateSessionIds,
  withAccountSessionLock,
} from "@/services/sessionCleanupService";

describe("single-session cleanup", () => {
  it("keeps the newest session per account and retires older ones", () => {
    expect(
      selectDuplicateSessionIds([
        { id: "new-a", billingAccountId: "account-a" },
        { id: "new-b", billingAccountId: "account-b" },
        { id: "old-a-1", billingAccountId: "account-a" },
        { id: "unowned", billingAccountId: null },
        { id: "old-a-2", billingAccountId: "account-a" },
        { id: "old-b", billingAccountId: "account-b" },
      ])
    ).toEqual(["old-a-1", "old-a-2", "old-b"]);
  });

  it("serializes concurrent starts for the same account", async () => {
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = withAccountSessionLock("lock-test", async () => {
      events.push("first:start");
      await firstBlocked;
      events.push("first:end");
    });
    const second = withAccountSessionLock("lock-test", async () => {
      events.push("second:start");
      events.push("second:end");
    });

    await Promise.resolve();
    expect(events).toEqual(["first:start"]);
    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual([
      "first:start",
      "first:end",
      "second:start",
      "second:end",
    ]);
  });
});

describe("partial media cleanup", () => {
  it("recognizes yt-dlp temporary and fragment files", () => {
    expect(isYtDlpTempFile("source.temp.mp4")).toBe(true);
    expect(isYtDlpTempFile("source.f137.mp4.part")).toBe(true);
    expect(isYtDlpTempFile("source-frag42.ts")).toBe(true);
    expect(isYtDlpTempFile("source.mp4")).toBe(false);
  });

  it("recognizes redundant split-format tracks without matching final files", () => {
    expect(isYtDlpSplitSourceFile("source.f137.mp4")).toBe(true);
    expect(isYtDlpSplitSourceFile("source.f251.webm")).toBe(true);
    expect(isYtDlpSplitSourceFile("source.audio.m4a")).toBe(false);
    expect(isYtDlpSplitSourceFile("source.mp4")).toBe(false);
  });
});
