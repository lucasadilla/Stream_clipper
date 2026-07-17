import { NextRequest } from "next/server";
import { jsonResponse } from "@/lib/utils";
import {
  requireAuthUserId,
  SessionAccessError,
} from "@/services/social/socialAccessService";
import {
  cancelPublishGroup,
  enqueuePublishGroup,
  getPublishGroup,
  unschedulePublishGroup,
  validatePublishGroup,
} from "@/services/social/socialPublishingService";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await requireAuthUserId(request);
    const { id } = await context.params;
    const group = await getPublishGroup(id, userId);
    if (!group) return jsonResponse({ error: "Not found" }, 404);
    return jsonResponse({ group });
  } catch (error) {
    if (error instanceof SessionAccessError) {
      return jsonResponse({ error: error.message }, error.status);
    }
    return jsonResponse({ error: "Failed to load publish group" }, 500);
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await requireAuthUserId(request);
    const { id } = await context.params;
    const body = (await request.json()) as {
      action?: "validate" | "publish" | "schedule" | "cancel" | "unschedule";
      scheduledFor?: string;
    };

    if (body.action === "validate") {
      const group = await validatePublishGroup(userId, id);
      return jsonResponse({ group });
    }
    if (body.action === "cancel") {
      const group = await cancelPublishGroup(userId, id);
      return jsonResponse({ group });
    }
    if (body.action === "unschedule") {
      const group = await unschedulePublishGroup(userId, id);
      return jsonResponse({ group });
    }
    if (body.action === "schedule") {
      const scheduledFor = body.scheduledFor ? new Date(body.scheduledFor) : null;
      const group = await enqueuePublishGroup({
        userId,
        groupId: id,
        mode: "schedule",
        scheduledFor,
      });
      return jsonResponse({ group });
    }
    if (body.action === "publish") {
      const group = await enqueuePublishGroup({
        userId,
        groupId: id,
        mode: "now",
      });
      // Kick the in-process worker so local/dev publishes don't sit queued.
      void import("@/services/workerService")
        .then(({ runWorkerTick }) => runWorkerTick())
        .catch(() => undefined);
      return jsonResponse({ group });
    }
    return jsonResponse({ error: "Unknown action" }, 400);
  } catch (error) {
    if (error instanceof SessionAccessError) {
      return jsonResponse({ error: error.message }, error.status);
    }
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Action failed" },
      400
    );
  }
}
