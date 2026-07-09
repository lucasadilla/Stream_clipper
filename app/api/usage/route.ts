import { NextRequest } from "next/server";
import { getUsageSnapshot } from "@/services/usageService";
import { errorResponse, jsonResponse } from "@/lib/utils";
import { getBillingAccountIdFromRequest } from "@/services/billingService";

export async function GET(request: NextRequest) {
  try {
    const snapshot = await getUsageSnapshot(getBillingAccountIdFromRequest(request));
    return jsonResponse(snapshot);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load usage";
    return errorResponse(message, 500);
  }
}
