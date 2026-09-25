import { afterEach, describe, expect, it, vi } from "vitest";
import {
  pollRenderJob,
  RenderJobFailedError,
} from "@/lib/clipActions";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("render job polling", () => {
  it("surfaces a terminal worker failure immediately", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          job: {
            status: "failed",
            progress: 0,
            stage: "failed",
            errorMessage: "Source download failed",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(pollRenderJob("job-1")).rejects.toEqual(
      expect.objectContaining<Partial<RenderJobFailedError>>({
        name: "RenderJobFailedError",
        message: "Source download failed",
      })
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
