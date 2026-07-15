import { NextRequest } from "next/server";
import { z } from "zod";
import { PENDING_CREATOR_CODE_COOKIE } from "@/services/authAccountService";
import { normalizeCreatorBetaCode } from "@/lib/creatorBeta";
import { errorResponse, jsonResponse } from "@/lib/utils";

const schema = z.object({
  code: z.string().max(80).optional().nullable(),
});

/** Stash a creator program code to redeem after OAuth / magic-link sign-in. */
export async function POST(request: NextRequest) {
  try {
    const body = schema.parse(await request.json());
    const normalized = body.code ? normalizeCreatorBetaCode(body.code) : "";
    const response = jsonResponse({
      ok: true,
      saved: Boolean(normalized),
    });
    if (normalized) {
      response.cookies.set(PENDING_CREATOR_CODE_COOKIE, normalized, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 60 * 60 * 2,
      });
    } else {
      response.cookies.delete(PENDING_CREATOR_CODE_COOKIE);
    }
    return response;
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(error.errors[0]?.message ?? "Invalid code", 400);
    }
    return errorResponse("Could not save creator code", 500);
  }
}
