import { NextRequest } from "next/server";
import { jsonResponse } from "@/lib/utils";
import {
  requireAuthUserId,
  SessionAccessError,
} from "@/services/social/socialAccessService";
import {
  getPublishingPreferences,
  upsertPublishingPreferences,
  type PublishingPreferencesView,
} from "@/services/social/socialPublishingPreferenceService";

export async function GET(request: NextRequest) {
  try {
    const userId = await requireAuthUserId(request);
    const preferences = await getPublishingPreferences(userId);
    return jsonResponse({ preferences });
  } catch (error) {
    if (error instanceof SessionAccessError) {
      return jsonResponse({ error: error.message }, error.status);
    }
    return jsonResponse({ error: "Failed to load preferences" }, 500);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const userId = await requireAuthUserId(request);
    const body = (await request.json()) as Partial<PublishingPreferencesView>;
    const preferences = await upsertPublishingPreferences(userId, body);
    return jsonResponse({ preferences });
  } catch (error) {
    if (error instanceof SessionAccessError) {
      return jsonResponse({ error: error.message }, error.status);
    }
    return jsonResponse(
      {
        error:
          error instanceof Error ? error.message : "Failed to save preferences",
      },
      400
    );
  }
}
