import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderClip, RenderAbortedError, pollRenderJob } from "@/lib/clipActions";
import { operationIdentity, operationKey, rememberOperation, rememberedOperation, operationDelay } from "@/lib/clientOperationRecovery";
import { preparePlatformFile, finishedPlatformStreamUrl } from "@/lib/platformExportClient";
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const storage = new Map<string, string>();
beforeEach(() => { storage.clear(); vi.stubGlobal("window", { localStorage: { getItem: (key: string) => storage.get(key) || null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) } }); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("saved operation recovery", () => {
  it("keeps a finished preview valid when captions refresh with identical content, but invalidates real edits", () => {
    const original = { range: [0, 20], edits: { second: { text: "Payoff" }, first: { text: "Setup" } }, appearance: { size: 40 } };
    const refreshed = { appearance: { size: 40 }, edits: { first: { text: "Setup" }, second: { text: "Payoff" } }, range: [0, 20] };
    expect(operationIdentity(original)).toBe(operationIdentity(refreshed));
    expect(operationIdentity(original)).not.toBe(operationIdentity({ ...refreshed, range: [0, 30] }));
    expect(operationIdentity(original)).not.toBe(operationIdentity({ ...refreshed, edits: { first: { text: "Corrected" } } }));
  });
  it("hashes equivalent settings, stores no transcript text, and expires old references", async () => {
    const key = await operationKey("render", { caption: "private transcript", format: "vertical" });
    expect(key).toBe(await operationKey("render", { format: "vertical", caption: "private transcript" }));
    rememberOperation(key, "job-one"); expect(rememberedOperation(key)).toBe("job-one");
    expect(JSON.stringify([...storage])).not.toContain("private transcript");
    storage.set(key!, JSON.stringify({ id: "job-one", at: Date.now() - 25 * 3600000 })); expect(rememberedOperation(key)).toBeNull();
  });
  it("resumes the same render after closing or aborting the wait without submitting another render", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn().mockResolvedValueOnce(json({ jobId: "job-one" })).mockResolvedValueOnce(json({ job: { status: "processing", progress: 60, stage: "encoding" } })).mockResolvedValueOnce(json({ job: { status: "completed", progress: 100 } }));
    vi.stubGlobal("fetch", fetcher);
    const range = { startTimeSeconds: 10, endTimeSeconds: 40 };
    await expect(renderClip("clip", "vertical", true, undefined, undefined, update => { if (update.stage === "encoding") controller.abort(); }, undefined, controller.signal, undefined, undefined, range)).rejects.toBeInstanceOf(RenderAbortedError);
    const result = await renderClip("clip", "vertical", true, undefined, undefined, undefined, undefined, undefined, undefined, undefined, range);
    expect(result.jobId).toBe("job-one"); expect(result.downloadUrl).toContain("job-one");
    expect(fetcher.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1);
    expect(fetcher.mock.calls[2][0]).toBe("/api/render-jobs/job-one");
  });
  it("does not reuse an older cut after its range changes", async () => {
    const fetcher = vi.fn().mockImplementation(async (_url, init) => init?.method === "POST" ? json({ jobId: "job" }) : json({ job: { status: "completed", progress: 100 } })); vi.stubGlobal("fetch", fetcher);
    for (const endTimeSeconds of [30, 40]) await renderClip("clip", "vertical", true, undefined, undefined, undefined, undefined, undefined, undefined, undefined, { startTimeSeconds: 0, endTimeSeconds });
    expect(fetcher.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(2);
  });
  it("recovers from a temporary polling outage and removes abort listeners after delays", async () => {
    vi.useFakeTimers(); const controller = new AbortController(); const remove = vi.spyOn(controller.signal, "removeEventListener");
    const fetcher = vi.fn().mockRejectedValueOnce(new TypeError("Network offline")).mockResolvedValueOnce(json({ job: { status: "completed", progress: 100 } })); vi.stubGlobal("fetch", fetcher);
    const updates = vi.fn(); const pending = pollRenderJob("job", updates, controller.signal);
    await vi.advanceTimersByTimeAsync(1201); await pending;
    expect(updates).toHaveBeenCalledWith(expect.objectContaining({ stage: "reconnecting" })); expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    const delay = operationDelay(10, controller.signal); await vi.advanceTimersByTimeAsync(10); await delay;
    expect(remove).toHaveBeenCalledTimes(2);
  });
  it("prepares a platform file once and reuses its exact file for preview and download", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({ pack: { id: "pack-one" } })).mockImplementation(async () => json({ pack: { exports: [{ platform: "x", status: "completed", downloadUrl: "/api/platform-exports/exact-export/download" }] } })); vi.stubGlobal("fetch", fetcher);
    const request = { sourceRenderJobId: "master", captionOptions: { x: false } };
    const url = await preparePlatformFile("clip", "x", request, vi.fn());
    expect(await preparePlatformFile("clip", "x", request, vi.fn())).toBe(url);
    expect(finishedPlatformStreamUrl(url)).toBe("/api/platform-exports/exact-export/stream");
    expect(finishedPlatformStreamUrl("https://other.example/video")).toBeNull();
    expect(fetcher.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1);
  });
});
