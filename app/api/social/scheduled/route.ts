import { NextRequest } from "next/server";
import { jsonResponse } from "@/lib/utils";
import {
  requireAuthUserId,
  SessionAccessError,
} from "@/services/social/socialAccessService";
import {
  listScheduledPublishGroups,
  unschedulePublishGroup,
} from "@/services/social/socialPublishingService";

export async function GET() {
  try {
    const userId = await requireAuthUserId();
    const scheduled = await listScheduledPublishGroups(userId);
    return jsonResponse({ scheduled });
  } catch (error) {
    if (error instanceof SessionAccessError) {
      return jsonResponse({ error: error.message }, error.status);
    }
    return jsonResponse({ error: "Failed to load scheduled publishes" }, 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await requireAuthUserId();
    const body = (await request.json()) as {
      action?: "unschedule";
      groupId?: string;
    };
    if (body.action !== "unschedule" || !body.groupId) {
      return jsonResponse({ error: "Unknown action" }, 400);
    }
    const group = await unschedulePublishGroup(userId, body.groupId);
    return jsonResponse({ group });
  } catch (error) {
    if (error instanceof SessionAccessError) {
      return jsonResponse({ error: error.message }, error.status);
    }
    return jsonResponse(
      {
        error:
          error instanceof Error ? error.message : "Could not cancel schedule",
      },
      400
    );
  }
}
