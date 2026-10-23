import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultChannelPreset } from "@/lib/social/channelPreset";
import { defaultPublishingPreferences } from "@/lib/social/preferences";
import { renderSpecHash } from "@/lib/renderSpec";
const m = vi.hoisted(() => ({
  row: {} as Record<string, unknown>, preset: vi.fn(), export: vi.fn(), variant: vi.fn(), create: vi.fn(), enqueue: vi.fn(), update: vi.fn(), query: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: {
  $queryRaw: async () => [{ automation: "table", clips: "table" }],
  $transaction: async (work: unknown[]) => Promise.all(work),
  streamAutomationClip: { findFirst: async (query: unknown) => { m.query(query); return m.row; }, update: (...args: unknown[]) => m.update(...args) },
  streamAutomation: { findMany: async () => [], update: vi.fn() },
  renderJob: { findUnique: async () => ({ status: "completed", qualityReview: null }) },
  connectedSocialAccount: { findMany: async () => [{ id: "account", platform: "youtube" }] },
  platformExport: { findFirst: (...args: unknown[]) => m.variant(...args), findMany: async () => [] },
} }));
vi.mock("@/services/social/channelPresetService", () => ({ getChannelPreset: (...args: unknown[]) => m.preset(...args) }));
vi.mock("@/services/social/socialPublishingPreferenceService", () => ({ getPublishingPreferences: async () => defaultPublishingPreferences() }));
vi.mock("@/services/platformExportService", () => ({ createPlatformExportPack: (...args: unknown[]) => m.export(...args) }));
vi.mock("@/services/social/socialPublishingService", () => ({ createPublishGroup: (...args: unknown[]) => m.create(...args), enqueuePublishGroup: (...args: unknown[]) => m.enqueue(...args) }));
vi.mock("@/lib/social/capabilities", () => ({ canPublishPlatform: () => true }));
vi.mock("@/services/youtubeService", () => ({ createStreamSession: vi.fn() }));
vi.mock("@/services/ytDlpMetadataService", () => ({ fetchStreamPlatformMetadata: vi.fn(), fetchYtDlpMetadata: vi.fn() }));
vi.mock("@/services/sessionCleanupService", () => ({ replacePriorSessionsForAccount: vi.fn(), withAccountSessionLock: vi.fn() }));
vi.mock("@/services/liveRecordingService", () => ({ acquireSourceMedia: vi.fn(), resolveSourceRecordedSeconds: vi.fn() }));
vi.mock("@/services/livePipelineService", () => ({ runLivePipeline: vi.fn() }));
vi.mock("@/services/suggestClipsService", () => ({ autoSuggestClips: vi.fn() }));
vi.mock("@/services/clipAutoPrepareService", () => ({ buildAutoVerticalLayoutRequest: vi.fn(), prepareSuggestedClips: vi.fn() }));
vi.mock("@/services/verticalLayoutService", () => ({ getVerticalLayoutConfiguration: vi.fn(), requestFromVerticalLayoutConfiguration: vi.fn() }));
vi.mock("@/services/renderService", () => ({ createRenderJobRecord: vi.fn() }));
vi.mock("@/services/usageService", () => ({ canCreateStreamSession: vi.fn(), canRenderExport: vi.fn() }));
vi.mock("@/services/billingService", () => ({ hasAppAccess: vi.fn() }));
vi.mock("@/services/captionDirectorService", () => ({ prepareCaptionDirections: vi.fn() }));
import { processOneStreamAutomation } from "@/services/streamAutomationService";
beforeEach(() => {
  vi.clearAllMocks();
  m.row = { id: "automated", clipSuggestionId: "clip", renderJobId: "render", status: "rendering", automation: { userId: "owner", enabled: true, autoPublishEnabled: false, destinationAccountIds: ["account"] } };
  m.preset.mockResolvedValue(null); m.variant.mockResolvedValue(null); m.create.mockResolvedValue({ id: "group" });
});
describe("Autopilot publishing workspace integration", () => {
  it("creates review drafts for selected channels without enabling automatic posting", async () => {
    await processOneStreamAutomation();
    expect(m.create).toHaveBeenCalledWith(expect.objectContaining({ userId: "owner", destinations: [{ connectedSocialAccountId: "account", platform: "youtube" }], requestKey: "autopilot:automated" }));
    expect(m.enqueue).not.toHaveBeenCalled();
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "awaiting_review", publishGroupId: "group" }) }));
    expect(m.query).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ automation: { enabled: true } }) }));
  });
  it("renders a separate account-specific export and waits before preparing a post", async () => {
    const preset = defaultChannelPreset("Creator style"); preset.branding.text = "Creator"; preset.captionsEnabled = false;
    m.preset.mockResolvedValue(preset);
    await processOneStreamAutomation();
    expect(m.export).toHaveBeenCalledWith("clip", expect.objectContaining({ includeCaptions: false, burnSubtitles: false, generateCopy: false, channelPreset: { accountId: "account", preset } }));
    expect(m.create).not.toHaveBeenCalled(); expect(m.enqueue).not.toHaveBeenCalled();
    expect(m.variant).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ AND: [{ exportSettings: { path: ["channelPresetAccountId"], equals: "account" } }, { exportSettings: { path: ["channelPresetHash"], equals: renderSpecHash(preset) } }] }) }));
  });
  it("pins the completed channel export instead of falling back to a sibling account's file", async () => {
    m.preset.mockResolvedValue(defaultChannelPreset()); m.variant.mockResolvedValue({ id: "exact-export", status: "completed" });
    await processOneStreamAutomation();
    expect(m.export).not.toHaveBeenCalled();
    expect(m.create).toHaveBeenCalledWith(expect.objectContaining({ destinations: [expect.objectContaining({ connectedSocialAccountId: "account", platformExportId: "exact-export" })] }));
  });
  it("requires the existing export quality review before unattended posting", async () => {
    (m.row.automation as Record<string, unknown>).autoPublishEnabled = true;
    await processOneStreamAutomation();
    expect(m.create).not.toHaveBeenCalled(); expect(m.enqueue).not.toHaveBeenCalled();
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "failed", errorMessage: expect.stringContaining("quality review") }) }));
  });
});
