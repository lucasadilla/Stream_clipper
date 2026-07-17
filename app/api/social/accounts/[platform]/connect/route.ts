import { NextRequest } from "next/server";
import { isSocialPlatform } from "@/lib/social/types";
import { jsonResponse } from "@/lib/utils";
import {
  requireAuthUserId,
  SessionAccessError,
} from "@/services/social/socialAccessService";
import { beginOAuthConnect } from "@/services/social/socialConnectionService";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ platform: string }> }
) {
  try {
    const userId = await requireAuthUserId(request);
    const { platform } = await context.params;
    if (!isSocialPlatform(platform)) {
      return jsonResponse({ error: "Unsupported platform" }, 400);
    }
    const redirectAfter =
      request.nextUrl.searchParams.get("redirectAfter") ||
      "/settings/connected-accounts";
    const { url } = await beginOAuthConnect({
      userId,
      platform,
      redirectAfter,
    });
    return Response.redirect(url, 302);
  } catch (error) {
    if (error instanceof SessionAccessError) {
      return jsonResponse({ error: error.message }, error.status);
    }
    const message = error instanceof Error ? error.message : "Connect failed";
    const dest = new URL("/settings/connected-accounts", request.nextUrl.origin);
    dest.searchParams.set("error", message);
    return Response.redirect(dest, 302);
  }
}
