import { NextRequest, NextResponse } from "next/server";
import { BILLING_ACCOUNT_COOKIE } from "@/lib/stripe";
import {
  deleteBillingAccount,
  getBillingAccountIdFromRequest,
} from "@/services/billingService";
import { errorResponse } from "@/lib/utils";

export async function DELETE(request: NextRequest) {
  try {
    const accountId = getBillingAccountIdFromRequest(request);
    const result = await deleteBillingAccount(accountId);

    const response = NextResponse.json({
      success: true,
      deletedSessions: result.deletedSessions,
    });
    response.cookies.set(BILLING_ACCOUNT_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    });
    return response;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to delete account";
    const status = /sign in/i.test(message) ? 401 : 400;
    return errorResponse(message, status);
  }
}
