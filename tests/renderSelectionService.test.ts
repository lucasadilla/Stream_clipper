import { expect, it, vi } from "vitest";
const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { renderJob: { findMany } } }));
import { getLatestCompletedFinalRenderJob } from "@/services/renderSelectionService";

it("finds the general download even after many platform exports", async () => {
  const general = { id: "general", outputPath: "general.mp4", params: { format: "vertical" } };
  findMany.mockResolvedValueOnce(Array.from({ length: 50 }, (_, i) => ({
    id: `platform-${i}`, outputPath: `platform-${i}.mp4`,
    params: { platformTarget: { platform: "tiktok", outputId: "vertical" } },
  }))).mockResolvedValueOnce([general]);
  expect(await getLatestCompletedFinalRenderJob("clip-1")).toEqual(general);
  expect(findMany.mock.calls[1][0].skip).toBe(50);
});
