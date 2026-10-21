import { NextRequest } from "next/server";
import { publicOrigin } from "@/lib/social/oauth";
import { safeSocialRedirect } from "@/lib/social/publishingPolicy";
import { requireAuthUserId } from "@/services/social/socialAccessService";
import { jsonResponse } from "@/lib/utils";
import {
  completeMetaOAuth,
  completeTikTokOAuth,
  completeXOauth,
  completeYouTubeOAuth,
} from "@/services/social/socialConnectionService";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ platform: string }> }
) {
  const { platform } = await context.params;
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const oauthError = request.nextUrl.searchParams.get("error");

  const dest = new URL("/settings/connected-accounts", publicOrigin());

  if (oauthError) {
    dest.searchParams.set("error", oauthError);
    return Response.redirect(dest, 302);
  }
  if (!code || !state) {
    dest.searchParams.set("error", "Missing OAuth code or state");
    return Response.redirect(dest, 302);
  }

  try {
    const userId = await requireAuthUserId(request);
    if (platform === "youtube") {
      const result = await completeYouTubeOAuth({ code, state, userId });
      const redirect = new URL(safeSocialRedirect(result.redirectAfter), publicOrigin());
      redirect.searchParams.set("connected", "youtube");
      return Response.redirect(redirect, 302);
    }
    if (platform === "x") {
      const result = await completeXOauth({ code, state, userId });
      const redirect = new URL(safeSocialRedirect(result.redirectAfter), publicOrigin());
      redirect.searchParams.set("connected", "x");
      return Response.redirect(redirect, 302);
    }
    if (platform === "tiktok") {
      const result = await completeTikTokOAuth({ code, state, userId });
      const redirect = new URL(safeSocialRedirect(result.redirectAfter), publicOrigin());
      redirect.searchParams.set("connected", "tiktok");
      return Response.redirect(redirect, 302);
    }
    if (platform === "facebook" || platform === "instagram") {
      const result = await completeMetaOAuth({
        code,
        state,
        platform,
        userId,
      });
      const redirect = new URL(safeSocialRedirect(result.redirectAfter), publicOrigin());
      redirect.searchParams.set("connected", platform);
      redirect.searchParams.set("count", String(result.accountIds.length));
      return Response.redirect(redirect, 302);
    }
    return jsonResponse({ error: "Unsupported platform callback" }, 400);
  } catch (error) {
    dest.searchParams.set(
      "error",
      error instanceof Error ? error.message : "OAuth failed"
    );
    return Response.redirect(dest, 302);
  }
}
