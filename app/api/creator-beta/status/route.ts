import { NextRequest } from "next/server";
import { jsonResponse } from "@/lib/utils";
import { getBillingAccountIdFromRequest } from "@/services/billingService";
import { getCreatorBetaStatus } from "@/services/creatorBetaService";

export async function GET(request: NextRequest) {
  return jsonResponse(
    await getCreatorBetaStatus(getBillingAccountIdFromRequest(request))
  );
}
