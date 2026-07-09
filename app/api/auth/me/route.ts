import { NextRequest } from "next/server";
import { getLoggedInAccount } from "@/services/accessService";
import { getBillingAccountIdFromRequest } from "@/services/billingService";
import { jsonResponse } from "@/lib/utils";

export async function GET(request: NextRequest) {
  const account = await getLoggedInAccount(
    getBillingAccountIdFromRequest(request)
  );
  return jsonResponse({ account });
}
