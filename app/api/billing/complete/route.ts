import { NextRequest, NextResponse } from "next/server";
import { resolvePublicOrigin } from "@/lib/publicOrigin";

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("session_id");
  const redirectUrl = new URL("/billing/activate", resolvePublicOrigin(request));

  if (!sessionId) {
    redirectUrl.searchParams.set("billing", "missing_session");
    return NextResponse.redirect(redirectUrl);
  }

  redirectUrl.searchParams.set("session_id", sessionId);
  return NextResponse.redirect(redirectUrl);
}
