import { NextRequest } from "next/server";
import { z } from "zod";
import { findClipFromDescription } from "@/services/findClipService";
import { errorResponse, jsonResponse } from "@/lib/utils";
import { getBillingAccountIdFromRequest } from "@/services/billingService";
import { getPostHogClient } from "@/lib/posthog-server";
import { normalizeCaptionAppearance } from "@/lib/captionAppearance";

const schema = z.object({
  description: z.string().min(3),
  autoRender: z.boolean().optional().default(true),
  includeCaptions: z.boolean().optional().default(true),
  captionAppearance: z.record(z.unknown()).optional(),
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
    const { description, autoRender, includeCaptions, captionAppearance } =
      schema.parse(body);

    const result = await findClipFromDescription(sessionId, description, {
      autoRender,
      includeCaptions,
      captionAppearance: captionAppearance
        ? normalizeCaptionAppearance(
            captionAppearance as Parameters<
              typeof normalizeCaptionAppearance
            >[0]
          )
        : undefined,
    });

    const billingAccountId = getBillingAccountIdFromRequest(request);
    if (billingAccountId) {
      getPostHogClient().capture({
        distinctId: billingAccountId,
        event: "ai_clip_search_completed",
        properties: {
          session_id: sessionId,
          clip_found: result.found,
          auto_render: autoRender,
          include_captions: includeCaptions,
          context_used: result.contextUsed,
        },
      });
    }

    return jsonResponse({
      found: result.found,
      answer: result.answer,
      clip: result.clip,
      renderJob: result.renderJob,
      contextUsed: result.contextUsed,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(error.errors[0]?.message ?? "Invalid input", 400);
    }
    const message = error instanceof Error ? error.message : "Find clip failed";
    if (/exceeded your current quota/i.test(message)) {
      return jsonResponse({
        found: false,
        answer:
          "The AI provider is out of credits, so I can't search right now. Add credits and try again.",
        clip: null,
        renderJob: null,
        contextUsed: 0,
      });
    }
    return errorResponse(message, 500);
  }
}
