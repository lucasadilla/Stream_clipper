import { NextRequest } from "next/server";
import { updateProfile } from "@/services/accessService";
import { getBillingAccountIdFromRequest } from "@/services/billingService";
import { errorResponse, jsonResponse } from "@/lib/utils";

export async function PATCH(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      displayName?: unknown;
      email?: unknown;
    };
    const patch: { displayName?: unknown; email?: unknown } = {};
    if ("displayName" in body) patch.displayName = body.displayName;
    if ("email" in body) patch.email = body.email;

    const account = await updateProfile(
      getBillingAccountIdFromRequest(request),
      patch
    );
    return jsonResponse({ account });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update profile";
    const status = /sign in/i.test(message) ? 401 : 400;
    return errorResponse(message, status);
  }
}
