import { NextRequest } from "next/server";
import {
  createPortalSession,
  getBillingAccountIdFromRequest,
} from "@/services/billingService";
import { resolvePublicOrigin } from "@/lib/publicOrigin";
import { errorResponse, jsonResponse } from "@/lib/utils";

export async function POST(request: NextRequest) {
  try {
    const session = await createPortalSession({
      accountId: getBillingAccountIdFromRequest(request),
      origin: resolvePublicOrigin(request),
    });
    return jsonResponse({ url: session.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to open billing portal";
    return errorResponse(message, 400);
  }
}
