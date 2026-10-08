import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn(), direct: vi.fn(), available: vi.fn(), router: vi.fn() }));
vi.mock("@/lib/aiProvider", () => ({
  hasAnyAiKey: mocks.available,
  getChatModel: () => "standard-writer",
  getAiClient: () => ({ chat: { completions: { create: mocks.create } } }),
  getOpenAiDirectClient: () => ({ chat: { completions: { create: mocks.direct } } }),
  isOpenRouterEnabled: mocks.router,
}));
vi.mock("@/lib/aiModelPolicy", () => ({
  getHookEnginePolicy: () => ({ strong: { model: "editor", maxTokens: 6000, timeoutMs: 30000 } }),
}));

import { writeClipEditorial } from "@/services/clipEditorialService";

const source = {
  id: "moment",
  transcript: "The camera kept disconnecting. I replaced the cable and the camera finally worked. Buying a new camera would have wasted money.",
};
const proposal = {
  id: source.id,
  subject: "A malfunctioning camera",
  centralPoint: "Replacing the cable fixed the camera without buying a replacement.",
  title: "A cable swap saved this camera",
  description: "A faulty connection made the camera seem broken. Replacing the cable solved the problem and avoided an unnecessary purchase.",
  evidence: "I replaced the cable and the camera finally worked",
};
const response = (value: unknown) => ({ choices: [{ message: { content: JSON.stringify(value) } }] });
const write = (value = proposal) => response({ clips: [value] });

describe("single-pass clip copy", () => {
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => {
    mocks.create.mockReset();
    mocks.direct.mockReset();
    mocks.router.mockReturnValue(true);
    mocks.available.mockReturnValue(true);
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("CLIP_COPY_MODEL", "");
  });

  it("writes the whole selected batch with exactly one call and no AI scoring", async () => {
    const colors = ["red", "blue", "green", "silver", "black", "white", "orange", "purple", "yellow", "bronze"];
    const inputs = colors.map((color, i) => ({ ...source, id: `clip-${i}`, transcript: `${source.transcript} The camera was ${color}.` }));
    mocks.create.mockResolvedValue(response({ clips: inputs.map((input, i) => ({
      ...proposal, id: input.id, title: `A cable swap saved the ${colors[i]} camera`,
    })) }));
    const result = await writeClipEditorial(inputs);
    expect(result.size).toBe(10);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(result.get("clip-0")).toMatchObject({ version: 2, mode: "single_pass" });
    expect(mocks.create.mock.calls[0][0]).toMatchObject({ model: "standard-writer", max_tokens: 3300 });
    expect(mocks.create.mock.calls[0][1]).toMatchObject({ maxRetries: 0 });
  });

  it("keeps fragment and evidence checks without paid repair passes", async () => {
    mocks.create.mockResolvedValue(write({ ...proposal, title: "I replaced the cable and the camera finally worked" }));
    await expect(writeClipEditorial([source])).rejects.toThrow("No unfinished copy was saved");
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it("rejects unsupported evidence without generating again", async () => {
    mocks.create.mockResolvedValue(write({ ...proposal, evidence: "a new camera cost five hundred dollars" }));
    await expect(writeClipEditorial([source])).rejects.toThrow("No unfinished copy was saved");
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it("accepts valid entries independently of malformed and duplicate entries", async () => {
    mocks.create.mockResolvedValue(response({ clips: [proposal, { id: "invalid" },
      { ...proposal, id: "duplicate" }] }));
    const result = await writeClipEditorial([source, { ...source, id: "invalid" }, { ...source, id: "duplicate" }]);
    expect([...result.keys()]).toEqual([source.id]);
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it("does not silently retry a failed writer", async () => {
    mocks.create.mockRejectedValue(new Error("provider unavailable"));
    await expect(writeClipEditorial([source])).rejects.toThrow("provider unavailable");
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it("reports credit failures without repeating requests", async () => {
    mocks.create.mockRejectedValue(Object.assign(new Error("payment required"), { status: 402 }));
    await expect(writeClipEditorial([source])).rejects.toThrow("insufficient credits");
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it("a configured backup writes once without a second reviewer call", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-backup");
    mocks.create.mockRejectedValue(Object.assign(new Error("payment required"), { status: 402 }));
    mocks.direct.mockResolvedValue(write());
    expect((await writeClipEditorial([source])).get(source.id)?.title).toBe(proposal.title);
    expect(mocks.direct).toHaveBeenCalledTimes(1);
  });

  it("does not replace duplicated existing copy using an automatic repair call", async () => {
    mocks.create.mockResolvedValue(write());
    await expect(writeClipEditorial([source], [proposal.title])).rejects.toThrow("No unfinished copy was saved");
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it("makes no call when there are no selected clips", async () => {
    expect((await writeClipEditorial([])).size).toBe(0);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
