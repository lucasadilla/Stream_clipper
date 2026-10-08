import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn(), available: vi.fn() }));
vi.mock("@/lib/aiProvider", () => ({
  hasAnyAiKey: mocks.available,
  getAiClient: () => ({ chat: { completions: { create: mocks.create } } }),
}));
vi.mock("@/lib/aiModelPolicy", () => ({
  getHookEnginePolicy: () => ({ strong: { model: "editor", maxTokens: 6000, timeoutMs: 30000 } }),
}));

import { writeReviewedClipEditorial } from "@/services/clipEditorialService";

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
const review = {
  id: source.id,
  completeHeadline: true,
  clearWithoutPriorContext: true,
  specificHook: true,
  titleSupported: true,
  descriptionSupported: true,
  descriptionAddsContext: true,
  feedback: "Supported and clear.",
};
const response = (value: unknown) => ({ choices: [{ message: { content: JSON.stringify(value) } }] });
const write = (value = proposal) => response({ clips: [value] });
const approve = () => response({ reviews: [review] });

describe("final clip editorial boundary", () => {
  beforeEach(() => {
    mocks.create.mockReset();
    mocks.available.mockReturnValue(true);
  });

  it("writes a new headline and distinct description, then requires independent approval", async () => {
    mocks.create.mockResolvedValueOnce(write()).mockResolvedValueOnce(approve());
    const result = await writeReviewedClipEditorial([source]);
    expect(result.get(source.id)).toMatchObject({ ...proposal, version: 1 });
    expect(mocks.create).toHaveBeenCalledTimes(2);
    const reviewPrompt = mocks.create.mock.calls[1][0].messages[1].content;
    expect(reviewPrompt).toContain(source.transcript);
    expect(reviewPrompt).toContain(proposal.description);
  });

  it("repairs rejected copy using review feedback instead of publishing it", async () => {
    const repaired = { ...proposal, title: "Why this camera needed a cable replacement" };
    mocks.create.mockResolvedValueOnce(write())
      .mockResolvedValueOnce(response({ reviews: [{ ...review, clearWithoutPriorContext: false, feedback: "Name the camera problem." }] }))
      .mockResolvedValueOnce(write(repaired)).mockResolvedValueOnce(approve());
    expect((await writeReviewedClipEditorial([source])).get(source.id)?.title).toBe(repaired.title);
    expect(mocks.create.mock.calls[2][0].messages[1].content).toContain("Name the camera problem.");
  });

  it("never saves a transcript span merely because it passes structural checks", async () => {
    mocks.create.mockResolvedValue(write({ ...proposal, title: "I replaced the cable and the camera finally worked" }));
    await expect(writeReviewedClipEditorial([source])).rejects.toThrow("no unfinished copy was saved");
    expect(mocks.create).toHaveBeenCalledTimes(2);
  });

  it("requires exact evidence from the selected clip", async () => {
    mocks.create.mockResolvedValue(write({ ...proposal, evidence: "a new camera cost five hundred dollars" }));
    await expect(writeReviewedClipEditorial([source])).rejects.toThrow("editorial review");
  });

  it("does not publish when the reviewer is unavailable", async () => {
    mocks.create.mockResolvedValueOnce(write()).mockRejectedValueOnce(new Error("provider unavailable"))
      .mockResolvedValueOnce(write()).mockRejectedValueOnce(new Error("provider unavailable"));
    await expect(writeReviewedClipEditorial([source])).rejects.toThrow("no unfinished copy was saved");
  });

  it("treats missing or duplicate reviewer verdicts as unapproved", async () => {
    mocks.create.mockResolvedValueOnce(write()).mockResolvedValueOnce(response({ reviews: [] }))
      .mockResolvedValueOnce(write()).mockResolvedValueOnce(response({ reviews: [review, review] }));
    await expect(writeReviewedClipEditorial([source])).rejects.toThrow("editorial review");
  });

  it("excludes unapproved moments without discarding approved moments", async () => {
    mocks.create.mockResolvedValueOnce(write()).mockResolvedValueOnce(approve())
      .mockResolvedValueOnce(response({ clips: [] }));
    const result = await writeReviewedClipEditorial([source, { ...source, id: "no-story" }]);
    expect([...result.keys()]).toEqual([source.id]);
  });

  it("does not repeat existing titles and requests a new angle", async () => {
    mocks.create.mockResolvedValueOnce(write())
      .mockResolvedValueOnce(write({ ...proposal, title: "Why this camera needed a cable replacement" }))
      .mockResolvedValueOnce(approve());
    const result = await writeReviewedClipEditorial([source], [proposal.title]);
    expect(result.get(source.id)?.title).not.toBe(proposal.title);
  });

  it("fails explicitly when AI is unavailable, without fallback titles", async () => {
    mocks.available.mockReturnValue(false);
    await expect(writeReviewedClipEditorial([source])).rejects.toThrow("AI is unavailable");
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
