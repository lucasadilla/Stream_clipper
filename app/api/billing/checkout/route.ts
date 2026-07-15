import { NextRequest } from "next/server";
import { z } from "zod";
import {
  createCheckoutSession,
  getBillingAccountIdFromRequest,
} from "@/services/billingService";
import { getLoggedInAccount } from "@/services/accessService";
import { resolvePublicOrigin } from "@/lib/publicOrigin";
import { errorResponse, jsonResponse, parseRequestJson } from "@/lib/utils";

const checkoutSchema = z.object({
  planId: z.string().min(1),
  interval: z.enum(["monthly", "yearly"]).default("monthly"),
});

export async function POST(request: NextRequest) {
  try {
    const body = await parseRequestJson(request);
    if (!body) return errorResponse("Request body required", 400);
    const { planId, interval } = checkoutSchema.parse(body);
    const account = await getLoggedInAccount(
      getBillingAccountIdFromRequest(request)
    );
    const session = await createCheckoutSession({
      planId,
      interval,
      origin: resolvePublicOrigin(request),
      customerEmail: account?.email,
      billingAccountId: account?.id,
    });
    return jsonResponse({ url: session.url });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(
        error.errors[0]?.message ?? "Invalid checkout request",
        400
      );
    }
    const message =
      error instanceof Error ? error.message : "Failed to start checkout";
    return errorResponse(message, 500);
  }
}
