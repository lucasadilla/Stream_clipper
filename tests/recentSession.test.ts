import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ user: vi.fn(), billing: vi.fn(), session: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { billingAccount: { findUnique: m.billing }, streamSession: { findFirst: m.session } } }));
vi.mock("@/services/social/socialAccessService", async () => {
  class SessionAccessError extends Error { constructor(message: string, public status: number) { super(message); } }
  return { requireAuthUserId: m.user, SessionAccessError };
});
vi.mock("@/services/sessionCleanupService", () => ({ REPLACED_SESSION_STATUS: "replaced" }));
import { GET } from "@/app/api/sessions/recent/route";
import { SessionAccessError } from "@/services/social/socialAccessService";
beforeEach(() => { vi.resetAllMocks(); m.user.mockResolvedValue("user-a"); m.billing.mockResolvedValue({ id: "billing-a" }); });
describe("resume only the authenticated user's workspace", () => {
  it("validates the remembered ID against ownership, then falls back to the latest saved session", async () => {
    m.session.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "safe-session", title: "My session" });
    const response = await GET(new Request("https://clipper.test/api/sessions/recent?last=another-users-session"));
    expect(await response.json()).toEqual({ session: { id: "safe-session", title: "My session" } });
    expect(m.session.mock.calls[0][0].where).toEqual({ id: "another-users-session", billingAccountId: "billing-a", NOT: { liveStatus: "replaced" } });
    expect(m.session.mock.calls[1][0].where.billingAccountId).toBe("billing-a");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("does not return remembered data to signed-out visitors", async () => {
    m.user.mockRejectedValue(new SessionAccessError("Sign in required", 401));
    expect(await (await GET(new Request("https://clipper.test/api/sessions/recent?last=private"))).json()).toEqual({ session: null });
    expect(m.session).not.toHaveBeenCalled();
  });
  it("does not calculate disk usage, create a session, or return private media paths", async () => {
    m.session.mockResolvedValue({ id: "mine", title: "My work" });
    await GET(new Request("https://clipper.test/api/sessions/recent"));
    expect(m.session.mock.calls[0][0].select).toEqual({ id: true, title: true });
  });
});
