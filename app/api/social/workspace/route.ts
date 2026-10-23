import { z } from "zod";
import { jsonResponse } from "@/lib/utils";
import { socialApiError } from "@/lib/social/apiError";
import { calendarRange } from "@/lib/social/workspace";
import { requireAuthUserId } from "@/services/social/socialAccessService";
import { getPublishingPreferences } from "@/services/social/socialPublishingPreferenceService";
import { approvePublishingPosts, changePublishingPost, listPublishingPosts, pausePublishing } from "@/services/social/publishingWorkspaceService";

export async function GET(request: Request) {
  try {
    const userId = await requireAuthUserId(request), params = new URL(request.url).searchParams;
    const view = z.enum(["inbox", "calendar", "performance"]).parse(params.get("view") || "inbox");
    const range = view === "calendar" ? calendarRange(params.get("from"), params.get("to")) : null;
    return Response.json({ ...await listPublishingPosts(userId, { view, start: range?.start, end: range?.end,
      cursor: params.get("cursor") || undefined, accountId: params.get("account") || undefined }), paused: (await getPublishingPreferences(userId)).publishingPaused }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return socialApiError(error); }
}
export async function POST(request: Request) {
  try {
    const userId = await requireAuthUserId(request);
    const body = z.discriminatedUnion("action", [
      z.object({ action: z.literal("approve"), jobs: z.array(z.unknown()).max(30), scheduledFor: z.string().optional() }),
      z.object({ action: z.enum(["pause", "resume"]) }),
      z.object({ action: z.enum(["reschedule", "hold", "cancel"]), id: z.string().min(1).max(100), version: z.string().datetime(), scheduledFor: z.string().datetime().optional() }),
    ]).parse(await request.json());
    if (body.action === "approve") {
      const result = await approvePublishingPosts(userId, body);
      void import("@/services/workerService").then(({ runWorkerTick }) => runWorkerTick()).catch(() => undefined);
      return jsonResponse(result);
    }
    if (body.action === "pause" || body.action === "resume") return jsonResponse(await pausePublishing(userId, body.action === "pause"));
    if ("id" in body) { await changePublishingPost(userId, body.id, body); return jsonResponse({ ok: true }); }
    throw new Error("Unknown action");
  } catch (error) { return socialApiError(error); }
}
