import { NextRequest } from "next/server";
import {
  getBillingAccount,
  getBillingAccountIdFromRequest,
  serializeBillingAccount,
} from "@/services/billingService";
import { jsonResponse } from "@/lib/utils";

export async function GET(request: NextRequest) {
  const account = await getBillingAccount(getBillingAccountIdFromRequest(request));
  return jsonResponse({
    billingAccount: account ? serializeBillingAccount(account) : null,
  });
}
