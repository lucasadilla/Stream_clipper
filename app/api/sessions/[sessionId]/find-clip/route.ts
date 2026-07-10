import { NextRequest } from "next/server";
import { z } from "zod";
import { findClipFromDescription } from "@/services/findClipService";
import { errorResponse, jsonResponse } from "@/lib/utils";
import { getBillingAccountIdFromRequest } from "@/services/billingService";
import { getPostHogClient } from "@/lib/posthog-server";

const schema = z.object({
  description: z.string().min(3),
  autoRender: z.boolean().optional().default(true),
});

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const body = await request.json();
    const { description, autoRender } = schema.parse(body);

    const result = await findClipFromDescription(sessionId, description, {
      autoRender,
    });

    const billingAccountId = getBillingAccountIdFromRequest(request);
    if (billingAccountId) {
      getPostHogClient().capture({
        distinctId: billingAccountId,
        event: "ai_clip_search_completed",
        properties: {
          session_id: sessionId,
          clip_found: !!result.clip,
          auto_render: autoRender,
        },
      });
    }

    return jsonResponse({
      answer: result.answer,
      clip: result.clip,
      renderJob: result.renderJob,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(error.errors[0]?.message ?? "Invalid input", 400);
    }
    const message = error instanceof Error ? error.message : "Find clip failed";
    return errorResponse(message, 500);
  }
}
