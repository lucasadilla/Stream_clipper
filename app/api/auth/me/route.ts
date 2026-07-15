import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { getLoggedInAccount } from "@/services/accessService";
import { getBillingAccountIdFromRequest } from "@/services/billingService";
import {
  ensureBillingAccountForAuthUser,
  setBillingAccountCookie,
} from "@/services/authAccountService";
import { jsonResponse } from "@/lib/utils";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  let accountId = getBillingAccountIdFromRequest(request);
  const session = await auth();

  if (session?.user?.id) {
    const linked = await prisma.billingAccount.findFirst({
      where: { userId: session.user.id },
      select: { id: true },
    });
    if (linked) {
      accountId = linked.id;
      await setBillingAccountCookie(linked.id);
    } else {
      const ensured = await ensureBillingAccountForAuthUser({
        userId: session.user.id,
        email: session.user.email,
        name: session.user.name,
        provider: "session",
        providerAccountId: session.user.id,
      });
      accountId = ensured.id;
    }
  }

  const account = await getLoggedInAccount(accountId);
  return jsonResponse({
    account,
    authUser: session?.user
      ? {
          id: session.user.id,
          email: session.user.email ?? null,
          name: session.user.name ?? null,
          image: session.user.image ?? null,
        }
      : null,
  });
}
