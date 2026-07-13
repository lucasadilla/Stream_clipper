import { NextRequest } from "next/server";
import {
  getBillingAccount,
  getBillingAccountIdFromRequest,
  getStripeBillingDetails,
  serializeBillingAccount,
} from "@/services/billingService";
import { jsonResponse } from "@/lib/utils";

export async function GET(request: NextRequest) {
  const accountId = getBillingAccountIdFromRequest(request);
  const account = await getBillingAccount(accountId);
  const stripeDetails = await getStripeBillingDetails(accountId);
  return jsonResponse({
    billingAccount: account ? serializeBillingAccount(account) : null,
    stripeDetails,
  });
}
