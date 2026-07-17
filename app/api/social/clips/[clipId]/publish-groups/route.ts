import { NextRequest } from "next/server";
import { isSocialPlatform, type SocialPlatform, type SocialPublishSettings } from "@/lib/social/types";
import { jsonResponse } from "@/lib/utils";
import {
  requireClipAccessForUser,
  SessionAccessError,
} from "@/services/social/socialAccessService";
import { createPublishGroup } from "@/services/social/socialPublishingService";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ clipId: string }> }
) {
  try {
    const { clipId } = await context.params;
    const { userId } = await requireClipAccessForUser(request, clipId);
    const body = (await request.json()) as {
      destinations?: Array<{
        connectedSocialAccountId: string;
        platform: string;
        destinationId?: string | null;
        settings?: SocialPublishSettings;
      }>;
    };

    const destinations = (body.destinations || [])
      .filter((d) => isSocialPlatform(d.platform))
      .map((d) => ({
        connectedSocialAccountId: d.connectedSocialAccountId,
        platform: d.platform as SocialPlatform,
        destinationId: d.destinationId,
        settings: d.settings,
      }));

    const group = await createPublishGroup({
      userId,
      clipSuggestionId: clipId,
      destinations,
    });
    return jsonResponse({ group }, 201);
  } catch (error) {
    if (error instanceof SessionAccessError) {
      return jsonResponse({ error: error.message }, error.status);
    }
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Could not create publish group" },
      400
    );
  }
}
