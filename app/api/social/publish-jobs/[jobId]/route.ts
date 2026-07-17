import { NextRequest } from "next/server";
import type { SocialGeneratedContent, SocialPublishSettings } from "@/lib/social/types";
import { jsonResponse } from "@/lib/utils";
import {
  requireAuthUserId,
  SessionAccessError,
} from "@/services/social/socialAccessService";
import {
  regeneratePublishJobContent,
  retryPublishJob,
  updatePublishJob,
} from "@/services/social/socialPublishingService";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ jobId: string }> }
) {
  try {
    const userId = await requireAuthUserId();
    const { jobId } = await context.params;
    const body = (await request.json()) as {
      editedContent?: SocialGeneratedContent;
      publishSettings?: SocialPublishSettings;
    };
    const group = await updatePublishJob(userId, jobId, body);
    return jsonResponse({ group });
  } catch (error) {
    if (error instanceof SessionAccessError) {
      return jsonResponse({ error: error.message }, error.status);
    }
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Update failed" },
      400
    );
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ jobId: string }> }
) {
  try {
    const userId = await requireAuthUserId();
    const { jobId } = await context.params;
    const body = (await request.json()) as { action?: "regenerate" | "retry" };
    if (body.action === "regenerate") {
      const group = await regeneratePublishJobContent(userId, jobId);
      return jsonResponse({ group });
    }
    if (body.action === "retry") {
      const group = await retryPublishJob(userId, jobId);
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
